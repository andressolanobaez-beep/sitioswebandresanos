"""Transient cloud relay for Caja Futurística's customer and waiter pages.

The register is the durable source of truth. Render holds only in-memory
messages and rebuilds its active view when the register reconnects.
"""
from __future__ import annotations

import base64
import binascii
import copy
import json
import os
import re
import secrets
import sys
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DEFAULT_WEB_ROOT = ROOT / "dependencias" / "app" / "web"
STATIC_FILES = {
    "/cliente": ("cliente.html", "text/html; charset=utf-8"),
    "/cliente/": ("cliente.html", "text/html; charset=utf-8"),
    "/mesero": ("mesero.html", "text/html; charset=utf-8"),
    "/mesero/": ("mesero.html", "text/html; charset=utf-8"),
    "/comun.js": ("comun.js", "text/javascript; charset=utf-8"),
    "/cliente.js": ("cliente.js", "text/javascript; charset=utf-8"),
    "/mesero.js": ("mesero.js", "text/javascript; charset=utf-8"),
    "/estilos.css": ("estilos.css", "text/css; charset=utf-8"),
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
    "/logo.svg": ("logo.svg", "image/svg+xml"),
}
IMAGE_NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
ORDER_STATUSES = {"pendiente", "abierto", "rechazado", "pagado", "cancelado"}
MAX_BODY = 12_000_000
MAX_IMAGE = 4_000_000


class RelayError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        *,
        pos_token: str,
        waiter_pin: str,
        public_url: str,
        web_root: Path = DEFAULT_WEB_ROOT,
    ) -> None:
        self.pos_token = pos_token
        self.waiter_pin = waiter_pin
        self.public_url = public_url.rstrip("/")
        self.web_root = Path(web_root)
        self.lock = threading.RLock()
        self.catalog: dict[str, Any] | None = None
        self.orders: dict[str, dict[str, Any]] = {}
        self.images: dict[str, tuple[str, bytes]] = {}
        self.rate_lock = threading.Lock()
        self.order_attempts: dict[str, list[float]] = {}
        super().__init__(address, RelayHandler)

    def check_rate_limit(self, client_ip: str) -> None:
        now = time.monotonic()
        with self.rate_lock:
            if len(self.order_attempts) > 2000:
                self.order_attempts = {
                    ip: attempts
                    for ip, attempts in self.order_attempts.items()
                    if any(now - attempt < 60 for attempt in attempts)
                }
            recent = [
                attempt
                for attempt in self.order_attempts.get(client_ip, [])
                if now - attempt < 60
            ]
            if len(recent) >= 60:
                raise RelayError("Se enviaron demasiados pedidos. Intenta en un minuto.", 429)
            recent.append(now)
            self.order_attempts[client_ip] = recent

    def prune_orders(self) -> None:
        cutoff = time.monotonic() - 24 * 60 * 60
        with self.lock:
            expired = [
                identifier
                for identifier, row in self.orders.items()
                if row["status"] not in ("pendiente", "abierto")
                and row["created_at"] < cutoff
            ]
            for identifier in expired:
                self.orders.pop(identifier, None)
            if len(self.orders) > 2500:
                closed = sorted(
                    (
                        row for row in self.orders.values()
                        if row["status"] not in ("pendiente", "abierto")
                    ),
                    key=lambda row: row["created_at"],
                )
                for row in closed[:len(self.orders) - 2500]:
                    self.orders.pop(row["id"], None)

    def waiter_orders(self) -> list[dict[str, Any]]:
        with self.lock:
            orders = [
                copy.deepcopy(row)
                for row in self.orders.values()
                if row["status"] == "pendiente"
            ]
        result = []
        for row in sorted(orders, key=lambda item: item["created_at"]):
            order = self._public_payload(row)
            order["action"] = row["action"]
            result.append(order)
        return result

    def cashier_inbox(self) -> list[dict[str, Any]]:
        with self.lock:
            rows = [
                copy.deepcopy(row)
                for row in self.orders.values()
                if row["status"] in ("pendiente", "abierto") or row["action"]
            ]
        return [
            {
                "id": row["id"],
                "pedido": row["pedido"],
                "estado": row["status"],
                "accion": row["action"],
                "id_local": row["local_id"],
                "mesero": row["mesero"],
                "motivo_rechazo": row["motivo_rechazo"],
            }
            for row in sorted(rows, key=lambda item: item["created_at"])
        ]

    @staticmethod
    def _public_payload(row: dict[str, Any]) -> dict[str, Any]:
        order = row["pedido"]
        allowed = (
            "mesa", "tipo", "items", "total", "hora", "creado", "nota", "origen"
        )
        result = {key: copy.deepcopy(order[key]) for key in allowed if key in order}
        result.update(
            {
                "id": row["id"],
                "estado": row["status"],
                "mesero": row["mesero"] or order.get("mesero", ""),
                "motivo_rechazo": row["motivo_rechazo"],
            }
        )
        return result


class RelayHandler(BaseHTTPRequestHandler):
    server: RelayServer
    server_version = "CajaRelay/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stdout.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")

    def _send_json(self, data: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._headers()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_bytes(self, body: bytes, mime: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self._headers()
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _redirect(self, target: str) -> None:
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Length", "0")
        self._headers()
        self.end_headers()

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError as error:
            raise RelayError("Longitud de petición inválida.") from error
        if length <= 0 or length > MAX_BODY:
            raise RelayError("La petición está vacía o es demasiado grande.", 413)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RelayError("El contenido no es JSON válido.") from error
        if not isinstance(data, dict):
            raise RelayError("Se esperaba un objeto JSON.")
        return data

    def _require_pos(self) -> None:
        auth = self.headers.get("Authorization", "")
        supplied = auth[7:] if auth.startswith("Bearer ") else ""
        if not supplied or not secrets.compare_digest(supplied, self.server.pos_token):
            raise RelayError("La caja no está autorizada.", 401)

    def _require_waiter(self) -> None:
        supplied = self.headers.get("X-Waiter-Pin", "")
        if not supplied or not secrets.compare_digest(supplied, self.server.waiter_pin):
            raise RelayError("PIN de mesero incorrecto.", 401)

    def _catalog(self) -> dict[str, Any]:
        with self.server.lock:
            if self.server.catalog is None:
                raise RelayError("La caja aún no se ha conectado para publicar la carta.", 503)
            return copy.deepcopy(self.server.catalog)

    def _public_order(self, identifier: str) -> dict[str, Any]:
        with self.server.lock:
            row = self.server.orders.get(identifier)
            if row is None:
                raise RelayError("Pedido no encontrado.", 404)
            order = self.server._public_payload(row)
            order["sincronizado"] = bool(row["local_id"])
        return order

    def do_GET(self) -> None:
        try:
            self._get()
        except RelayError as error:
            self._send_json({"ok": False, "error": str(error)}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.log_error("Error interno: %s", sys.exc_info()[1])
            self._send_json({"ok": False, "error": "Error interno del relay."}, 500)

    def _get(self) -> None:
        route = urlsplit(self.path).path
        if route == "/healthz":
            self._send_json({"ok": True})
            return
        if route == "/":
            self._redirect("/cliente")
            return
        if route == "/api/catalogo":
            self._send_json(self._catalog())
            return
        if route == "/api/mesero/pendientes":
            self._require_waiter()
            orders = self.server.waiter_orders()
            self._send_json({"ok": True, "pedidos": orders, "total": len(orders)})
            return
        if route.startswith("/api/cliente/pedido/"):
            identifier = route.rsplit("/", 1)[-1]
            try:
                uuid.UUID(hex=identifier)
            except ValueError as error:
                raise RelayError("Pedido no válido.", 404) from error
            self._send_json({"ok": True, "pedido": self._public_order(identifier)})
            return
        if route == "/api/pos/inbox":
            self._require_pos()
            self._send_json({"ok": True, "pedidos": self.server.cashier_inbox()})
            return
        if route.startswith("/api/imagen/"):
            self._image(route.rsplit("/", 1)[-1])
            return
        asset = STATIC_FILES.get(route)
        if asset:
            self._static(*asset)
            return
        if route.startswith("/api/"):
            raise RelayError("Ruta no encontrada.", 404)
        raise RelayError("Página no encontrada.", 404)

    def do_POST(self) -> None:
        try:
            self._post()
        except RelayError as error:
            self._send_json({"ok": False, "error": str(error)}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.log_error("Error interno: %s", sys.exc_info()[1])
            self._send_json({"ok": False, "error": "Error interno del relay."}, 500)

    def _post(self) -> None:
        route = urlsplit(self.path).path
        if route in ("/api/mesero/aceptar", "/api/mesero/rechazar"):
            self._require_waiter()
        elif route in (
            "/api/pos/catalogo",
            "/api/pos/publicar",
            "/api/pos/ack",
            "/api/pos/actualizar",
        ):
            self._require_pos()
        body = self._read_json()
        if route == "/api/cliente/pedido":
            self._create_customer_order(body)
        elif route in ("/api/mesero/aceptar", "/api/mesero/rechazar"):
            self._waiter_action(route, body)
        elif route == "/api/pos/catalogo":
            self._update_catalog(body)
        elif route == "/api/pos/publicar":
            self._publish_local_orders(body)
        elif route == "/api/pos/ack":
            self._acknowledge(body)
        elif route == "/api/pos/actualizar":
            self._update_from_cashier(body)
        else:
            raise RelayError("Ruta no encontrada.", 404)

    def _create_customer_order(self, body: dict[str, Any]) -> None:
        self.server.check_rate_limit(self.client_address[0])
        self.server.prune_orders()
        catalog = self._catalog()
        raw_items = body.get("items")
        menu = catalog.get("menu") or {}
        menu_items = menu.get("items") if isinstance(menu, dict) else []
        available = {
            str(item.get("id")): item
            for item in menu_items or []
            if isinstance(item, dict) and item.get("disponible") is not False
        }
        if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 40:
            raise RelayError("Agrega entre 1 y 40 artículos al pedido.")

        tipo = "llevar" if str(body.get("tipo", "mesa")).lower() == "llevar" else "mesa"
        mesa: int | None = None
        if tipo == "mesa":
            try:
                mesa = int(body.get("mesa"))
            except (TypeError, ValueError) as error:
                raise RelayError("Indica el número de mesa.") from error
            if not 1 <= mesa <= int(catalog.get("mesas_total", 0)):
                raise RelayError("El número de mesa no existe.")

        items = []
        total = 0.0
        for raw in raw_items:
            if not isinstance(raw, dict):
                raise RelayError("Un artículo del pedido no es válido.")
            item = available.get(str(raw.get("id", "")))
            if item is None:
                raise RelayError("Un artículo ya no está disponible.")
            quantity = raw.get("cantidad")
            if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 99:
                raise RelayError("La cantidad de un artículo debe ser de 1 a 99.")
            try:
                price = float(item["precio"])
            except (KeyError, TypeError, ValueError) as error:
                raise RelayError("La carta contiene un precio no válido.", 503) from error
            if price < 0:
                raise RelayError("La carta contiene un precio no válido.", 503)
            total += price * quantity
            items.append(
                {
                    "id": str(item["id"]),
                    "nombre": str(item.get("nombre", ""))[:100],
                    "precio": price,
                    "cantidad": quantity,
                    "nota": str(raw.get("nota", "") or "").strip()[:200],
                }
            )

        identifier = str(body.get("id", "")).lower() or uuid.uuid4().hex
        try:
            uuid.UUID(hex=identifier)
        except ValueError as error:
            raise RelayError("Identificador de pedido no válido.") from error
        now = datetime.now().astimezone()
        order = {
            "id": identifier,
            "numero": None,
            "creado": now.isoformat(timespec="seconds"),
            "fecha": now.strftime("%d/%m/%Y"),
            "fecha_iso": now.strftime("%Y-%m-%d"),
            "fecha_larga": now.strftime("%A %d/%m/%Y"),
            "hora": now.strftime("%H:%M:%S"),
            "mesero": "",
            "tipo": tipo,
            "mesa": mesa,
            "items": items,
            "nota": str(body.get("nota", "") or "").strip()[:300],
            "total": round(total, 2),
            "estado": "pendiente",
            "origen": "cliente",
            "motivo_rechazo": "",
        }
        with self.server.lock:
            row = self.server.orders.get(identifier)
            if row is None:
                row = self._new_order_row(identifier, order, "pendiente")
                self.server.orders[identifier] = row
            result = self._public_order(identifier)
        self._send_json({"ok": True, "pedido": result}, 201)

    @staticmethod
    def _new_order_row(
        identifier: str, order: dict[str, Any], status: str
    ) -> dict[str, Any]:
        return {
            "id": identifier,
            "pedido": copy.deepcopy(order),
            "status": status,
            "action": None,
            "local_id": "",
            "mesero": "",
            "motivo_rechazo": "",
            "created_at": time.monotonic(),
        }

    def _waiter_action(self, route: str, body: dict[str, Any]) -> None:
        identifier = str(body.get("id", "")).lower()
        try:
            uuid.UUID(hex=identifier)
        except ValueError as error:
            raise RelayError("Pedido no válido.", 404) from error
        waiter = str(body.get("mesero", "") or "").strip()[:40]
        if not waiter:
            raise RelayError("Escribe tu nombre.")
        if route.endswith("/rechazar"):
            reason = str(body.get("motivo", "") or "").strip()[:200]
            if not reason:
                raise RelayError("Escribe el motivo del rechazo.")
            action = "rechazar"
        else:
            reason = ""
            action = "aceptar"

        with self.server.lock:
            row = self.server.orders.get(identifier)
            if row is None:
                raise RelayError("Pedido no encontrado.", 404)
            if row["status"] != "pendiente":
                raise RelayError("Ese pedido ya fue atendido.", 409)
            if row["action"] and row["action"] != action:
                raise RelayError("Otro mesero ya está atendiendo este pedido.", 409)
            row["action"] = action
            row["mesero"] = waiter
            row["motivo_rechazo"] = reason
            row["pedido"]["mesero"] = waiter
            row["pedido"]["motivo_rechazo"] = reason
            order = self.server._public_payload(row)
            order["action"] = action
        self._send_json({"ok": True, "pedido": order})

    def _update_catalog(self, body: dict[str, Any]) -> None:
        catalog = body.get("catalogo")
        if not isinstance(catalog, dict) or not isinstance(catalog.get("menu"), dict):
            raise RelayError("La caja envió una carta no válida.")
        tables = catalog.get("mesas_total")
        if isinstance(tables, bool) or not isinstance(tables, int) or not 1 <= tables <= 99:
            raise RelayError("La cantidad de mesas no es válida.")
        catalog["servidor"] = {
            "url": self.server.public_url,
            "url_mesero": self.server.public_url + "/mesero",
            "url_cliente": self.server.public_url + "/cliente",
            "relay": True,
        }

        images = body.get("imagenes", [])
        if not isinstance(images, list) or len(images) > 100:
            raise RelayError("La lista de imágenes no es válida.")
        new_images: dict[str, tuple[str, bytes]] = {}
        total_bytes = 0
        for image in images:
            if not isinstance(image, dict):
                raise RelayError("Una imagen no es válida.")
            name = str(image.get("nombre", ""))
            mime = str(image.get("mime", ""))
            if not IMAGE_NAME.fullmatch(name) or mime not in {
                "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/bmp"
            }:
                raise RelayError("El nombre o tipo de una imagen no es válido.")
            try:
                data = base64.b64decode(str(image.get("datos", "")), validate=True)
            except (binascii.Error, ValueError) as error:
                raise RelayError("Una imagen no está codificada correctamente.") from error
            if not data or len(data) > MAX_IMAGE:
                raise RelayError("Una imagen excede el límite permitido.")
            total_bytes += len(data)
            if total_bytes > 8_000_000:
                raise RelayError("El total de imágenes excede el límite permitido.", 413)
            new_images[name] = (mime, data)
        with self.server.lock:
            self.server.catalog = copy.deepcopy(catalog)
            self.server.images = new_images
        self._send_json({"ok": True, "imagenes": len(new_images)})

    def _publish_local_orders(self, body: dict[str, Any]) -> None:
        orders = body.get("pedidos")
        if not isinstance(orders, list) or len(orders) > 2000:
            raise RelayError("La lista de pedidos de la caja no es válida.")
        for local in orders:
            if not isinstance(local, dict):
                raise RelayError("La caja publicó un pedido no válido.")
            identifier = str(local.get("id_remoto", "")).lower()
            local_id = str(local.get("id", ""))
            status = local.get("estado")
            if (
                not re.fullmatch(r"[0-9a-f]{32}", identifier)
                or not re.fullmatch(r"P-\d{4,}", local_id)
                or status not in ORDER_STATUSES
            ):
                raise RelayError("La referencia local del pedido no es válida.")
            public_order = copy.deepcopy(local)
            for key in ("id_remoto", "numero", "jornada", "impreso"):
                public_order.pop(key, None)
            public_order["id"] = identifier
            with self.server.lock:
                row = self.server.orders.get(identifier)
                if row is None:
                    row = self._new_order_row(identifier, public_order, status)
                    self.server.orders[identifier] = row
                if row["status"] == "pendiente" and status == "pendiente" and row["action"]:
                    row["pedido"] = public_order
                    row["pedido"]["mesero"] = row["mesero"]
                    row["pedido"]["motivo_rechazo"] = row["motivo_rechazo"]
                else:
                    row["pedido"] = public_order
                    row["status"] = status
                    row["action"] = None
                    row["mesero"] = str(local.get("mesero", "") or "")
                    row["motivo_rechazo"] = str(local.get("motivo_rechazo", "") or "")
                row["local_id"] = local_id
        self.server.prune_orders()
        self._send_json({"ok": True, "pedidos": len(orders)})

    def _acknowledge(self, body: dict[str, Any]) -> None:
        identifier = str(body.get("id", "")).lower()
        local_id = str(body.get("id_local", ""))
        order = body.get("pedido")
        if (
            not re.fullmatch(r"[0-9a-f]{32}", identifier)
            or not re.fullmatch(r"P-\d{4,}", local_id)
            or not isinstance(order, dict)
            or order.get("estado") not in ORDER_STATUSES
        ):
            raise RelayError("La referencia del pedido no es válida.")
        with self.server.lock:
            row = self.server.orders.get(identifier)
            if row is None:
                raise RelayError("Pedido no encontrado.", 404)
            self._merge_local_order(row, order)
            row["local_id"] = local_id
            if body.get("preservar_accion") is not True:
                row["status"] = str(order["estado"])
                row["action"] = None
        self._send_json({"ok": True})

    def _update_from_cashier(self, body: dict[str, Any]) -> None:
        identifier = str(body.get("id", "")).lower()
        local_id = str(body.get("id_local", ""))
        order = body.get("pedido")
        if (
            not re.fullmatch(r"[0-9a-f]{32}", identifier)
            or not re.fullmatch(r"P-\d{4,}", local_id)
            or not isinstance(order, dict)
            or order.get("estado") not in ORDER_STATUSES
        ):
            raise RelayError("La actualización del pedido no es válida.")
        with self.server.lock:
            row = self.server.orders.get(identifier)
            if row is None:
                raise RelayError("Pedido no encontrado.", 404)
            if row["local_id"] != local_id:
                raise RelayError("La caja no tiene asignado ese pedido.", 409)
            self._merge_local_order(row, order)
            row["status"] = str(order["estado"])
            row["action"] = None
        self._send_json({"ok": True})

    @staticmethod
    def _merge_local_order(row: dict[str, Any], local: dict[str, Any]) -> None:
        for key in (
            "estado", "mesero", "total", "hora", "fecha", "fecha_iso", "creado",
            "motivo_rechazo", "aceptado_en", "aceptado_por", "rechazado_en",
            "rechazado_por", "pagado_en", "metodo_pago", "cancelado_en",
            "motivo_cancelacion",
        ):
            if key in local:
                row["pedido"][key] = local[key]
        row["mesero"] = str(local.get("mesero", row["mesero"]) or "")
        row["motivo_rechazo"] = str(
            local.get("motivo_rechazo", row["motivo_rechazo"]) or ""
        )

    def _image(self, name: str) -> None:
        if not IMAGE_NAME.fullmatch(name):
            raise RelayError("Imagen no encontrada.", 404)
        with self.server.lock:
            image = self.server.images.get(name)
        if image is None:
            raise RelayError("Imagen no encontrada.", 404)
        self._send_bytes(image[1], image[0])

    def _static(self, filename: str, mime: str) -> None:
        path = (self.server.web_root / filename).resolve()
        if self.server.web_root.resolve() not in path.parents or not path.is_file():
            raise RelayError("Archivo no encontrado.", 404)
        self._send_bytes(path.read_bytes(), mime)


def main() -> int:
    pos_token = os.environ.get("RELAY_POS_TOKEN", "")
    waiter_pin = os.environ.get("RELAY_WAITER_PIN", "")
    public_url = os.environ.get("PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL", "")
    parsed_url = urlsplit(public_url)
    if len(pos_token) < 32:
        raise SystemExit("Configura RELAY_POS_TOKEN con al menos 32 caracteres aleatorios.")
    if len(waiter_pin) < 6:
        raise SystemExit("Configura RELAY_WAITER_PIN con al menos 6 caracteres.")
    if parsed_url.scheme != "https" or not parsed_url.netloc or parsed_url.path not in ("", "/"):
        raise SystemExit("Configura PUBLIC_URL con el URL HTTPS público del sitio Render.")

    web_root = Path(os.environ.get("POS_WEB_ROOT", str(DEFAULT_WEB_ROOT)))
    port = int(os.environ.get("PORT", "10000"))
    server = RelayServer(
        ("0.0.0.0", port),
        pos_token=pos_token,
        waiter_pin=waiter_pin,
        public_url=public_url,
        web_root=web_root,
    )
    print(
        f"Relay temporal listo en {public_url}; los pedidos durables quedan en la caja.",
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
