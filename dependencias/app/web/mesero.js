/* Caja Futurista · web del mesero: acepta o rechaza los pedidos de los clientes */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var CLAVE_NOMBRE = "pos_mesero";
  var CLAVE_PIN = "pos_mesero_pin";
  var CLAVE_SONIDO = "pos_mesero_sonido";
  var INTERVALO = 4000;

  var catalogo = null;
  var mesero = "";
  var pin = "";
  var sonido = true;
  var pedidos = [];
  var conocidos = {};
  var primeraCarga = true;
  var cargando = false;
  var ocupado = false;
  var rechazoId = null;

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (error) { /* opcional */ }
  }

  function leer(clave) {
    try { return localStorage.getItem(clave) || ""; } catch (error) { return ""; }
  }

  function dinero(valor) {
    return POS.dinero(valor, (catalogo && catalogo.moneda) || "$");
  }

  function pedirJSON(url, opciones) {
    var config = Object.assign({}, opciones || {});
    config.headers = Object.assign({}, config.headers || {});
    if (pin) config.headers["X-Waiter-Pin"] = pin;
    return POS.pedirJSON(url, config);
  }

  function mostrarError(id, texto) {
    var nodo = $(id);
    if (!nodo) return;
    if (texto) {
      nodo.textContent = texto;
      nodo.classList.remove("oculto");
    } else {
      nodo.textContent = "";
      nodo.classList.add("oculto");
    }
  }

  /* ================================================================== */
  /* Sonido y vibración                                                  */
  /* ================================================================== */
  function refrescarBotonSonido() {
    var icono = $("icono-sonido");
    if (icono) icono.textContent = sonido ? "🔔" : "🔕";
    var boton = $("btn-sonido");
    if (boton) boton.classList.toggle("silenciado", !sonido);
  }

  function avisarEntrada() {
    if (sonido) POS.sonarAlerta();
    if (navigator.vibrate) {
      try { navigator.vibrate([220, 90, 220]); } catch (error) { /* opcional */ }
    }
  }

  /* ================================================================== */
  /* Conexión y datos                                                    */
  /* ================================================================== */
  async function cargarCatalogo() {
    try {
      var datos = await POS.pedirJSON("/api/catalogo");
      catalogo = datos;
      aplicarMarca();
      var tema = POS.temaGuardado() || (datos.marca && datos.marca.tema) || "futurista";
      POS.aplicarTema(tema, false);
      $("led-conexion").className = "led verde";
      $("texto-conexion").textContent = "EN LÍNEA";
    } catch (error) {
      $("led-conexion").className = "led rojo";
      $("texto-conexion").textContent = "SIN WIFI";
    }
  }

  function aplicarMarca() {
    if (!catalogo) return;
    var marca = catalogo.marca || {};
    if (marca.negocio) {
      document.title = marca.negocio + " · Pedidos del mesero";
      var logo = $("logo-menor");
      if (logo) logo.innerHTML = POS.escapar(marca.negocio);
    }
    if (marca.aviso_cliente) {
      var aviso = $("aviso-cliente");
      if (aviso) aviso.textContent = marca.aviso_cliente;
    }
  }

  async function cargarPendientes() {
    if (cargando || ocupado) return;
    cargando = true;
    try {
      var datos = await pedirJSON("/api/mesero/pendientes");
      var lista = datos.pedidos || [];
      detectarNuevos(lista);
      pedidos = lista;
      $("led-conexion").className = "led verde";
      $("texto-conexion").textContent = "EN LÍNEA";
      render();
    } catch (error) {
      $("led-conexion").className = "led rojo";
      $("texto-conexion").textContent = error.estado === 401 ? "PIN INCORRECTO" : "SIN WIFI";
      if (error.estado === 401) {
        pin = "";
        try { sessionStorage.removeItem(CLAVE_PIN); } catch (storageError) { /* opcional */ }
        $("campo-pin-mesero").value = "";
        $("pantalla-nombre").classList.remove("oculto");
        mostrarError("error-nombre", error.message);
      }
    } finally {
      cargando = false;
      primeraCarga = false;
    }
  }

  function detectarNuevos(lista) {
    var nuevos = false;
    var mapa = {};
    lista.forEach(function (pedido) {
      mapa[pedido.id] = true;
      if (!conocidos[pedido.id]) nuevos = true;
    });
    conocidos = mapa;
    if (nuevos && !primeraCarga) avisarEntrada();
  }

  /* ================================================================== */
  /* Pintado de las tarjetas                                             */
  /* ================================================================== */
  function htmlItems(pedido) {
    return (pedido.items || []).map(function (item) {
      var nota = item.nota
        ? '<small class="nota-item">' + POS.escapar(item.nota) + "</small>"
        : "";
      return (
        "<li>" +
          '<span class="cant">' + Number(item.cantidad) + "×</span>" +
          '<span class="nombre">' + POS.escapar(item.nombre) + nota + "</span>" +
        "</li>"
      );
    }).join("");
  }

  function htmlTarjeta(pedido) {
    var accionEnCurso = pedido.action === "aceptar" || pedido.action === "rechazar";
    var textoAccion = pedido.action === "aceptar"
      ? "ENVIANDO A LA CAJA…"
      : "RECHAZO ENVIÁNDOSE…";
    var origen = pedido.origen === "cliente"
      ? '<span class="origen-cliente">PEDIDO DEL CLIENTE</span>'
      : "";
    var nota = pedido.nota
      ? '<p class="nota-pedido"><b>NOTA:</b> ' + POS.escapar(pedido.nota) + "</p>"
      : "";
    return (
      '<article class="tarjeta-pendiente" data-id="' + POS.escapar(pedido.id) + '">' +
        '<header class="pendiente-cab">' +
          '<span class="pendiente-mesa">' + POS.escapar(POS.destinoTexto(pedido)) + "</span>" +
          '<span class="pendiente-id">' + POS.escapar(pedido.id) + "</span>" +
          '<span class="pendiente-hora">' + POS.escapar(pedido.hora || "") +
            " · " + POS.escapar(POS.hace(pedido.creado)) + "</span>" +
        "</header>" +
        origen +
        '<ul class="pendiente-items">' + htmlItems(pedido) + "</ul>" +
        nota +
        '<div class="pendiente-pie">' +
          '<span class="pendiente-total">' + dinero(pedido.total) + "</span>" +
          '<div class="pendiente-acciones">' +
            '<button type="button" class="boton boton-verde boton-grande" data-accion="aceptar" data-id="' +
              POS.escapar(pedido.id) + '"' + (accionEnCurso ? " disabled" : "") + ">" +
              (accionEnCurso ? textoAccion : "ACEPTAR") + "</button>" +
            '<button type="button" class="boton boton-peligro" data-accion="rechazar" data-id="' +
              POS.escapar(pedido.id) + '"' + (accionEnCurso ? " disabled" : "") + ">" +
              (accionEnCurso ? "ESPERA…" : "RECHAZAR") + "</button>" +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function render() {
    var contador = $("contador-pendientes");
    if (contador) contador.textContent = pedidos.length;
    var contenedor = $("lista-pendientes");
    if (!contenedor) return;
    if (!pedidos.length) {
      contenedor.innerHTML =
        '<div class="vacio">' +
          '<div class="icono">▩</div>' +
          '<div class="titulo-vacio">NO HAY PEDIDOS POR ACEPTAR</div>' +
          "<p>Los pedidos que hagan los clientes con el código QR aparecerán aquí automáticamente.</p>" +
        "</div>";
      return;
    }
    contenedor.innerHTML = pedidos.map(htmlTarjeta).join("");
  }

  /* ================================================================== */
  /* Acciones                                                            */
  /* ================================================================== */
  async function aceptar(id, boton) {
    if (ocupado) return;
    if (!mesero) { cambiarMesero(); return; }
    ocupado = true;
    if (boton) { boton.disabled = true; boton.textContent = "ACEPTANDO…"; }
    try {
      await pedirJSON("/api/mesero/aceptar", {
        method: "POST",
        body: { id: id, mesero: mesero }
      });
      POS.aviso("Solicitud enviada a la caja para procesar el pedido.", "ok");
      delete conocidos[id];
      await cargarPendientes();
    } catch (error) {
      POS.aviso(error.message, "error", 5000);
      if (boton) { boton.disabled = false; boton.textContent = "ACEPTAR"; }
    } finally {
      ocupado = false;
    }
  }

  function abrirRechazo(id) {
    if (!mesero) { cambiarMesero(); return; }
    var pedido = pedidos.filter(function (p) { return p.id === id; })[0];
    rechazoId = id;
    $("rechazo-resumen").innerHTML =
      "Vas a rechazar el pedido <b>" + POS.escapar(id) + "</b>" +
      (pedido ? " de <b>" + POS.escapar(POS.destinoTexto(pedido)) + "</b>" : "") +
      ". El cliente verá el motivo.";
    $("motivo-rechazo").value = "";
    mostrarError("error-rechazo", "");
    POS.abrirModal("modal-rechazo", "#motivo-rechazo");
  }

  async function confirmarRechazo() {
    if (!rechazoId || ocupado) return;
    var motivo = $("motivo-rechazo").value.trim();
    if (!motivo) {
      mostrarError("error-rechazo", "Escribe el motivo para que el cliente lo entienda.");
      return;
    }
    ocupado = true;
    var boton = $("btn-confirmar-rechazo");
    boton.disabled = true;
    boton.textContent = "RECHAZANDO…";
    try {
      await pedirJSON("/api/mesero/rechazar", {
        method: "POST",
        body: { id: rechazoId, mesero: mesero, motivo: motivo }
      });
      POS.cerrarModal("modal-rechazo");
      POS.aviso("Solicitud de rechazo enviada a la caja.", "ok");
      delete conocidos[rechazoId];
      rechazoId = null;
      await cargarPendientes();
    } catch (error) {
      mostrarError("error-rechazo", error.message);
    } finally {
      ocupado = false;
      boton.disabled = false;
      boton.textContent = "RECHAZAR PEDIDO";
    }
  }

  /* ================================================================== */
  /* Nombre del mesero                                                   */
  /* ================================================================== */
  function usarMesero(nombre) {
    mesero = String(nombre || "").trim();
    if (!mesero) return false;
    guardar(CLAVE_NOMBRE, mesero);
    $("nombre-mesero").textContent = mesero;
    $("pantalla-nombre").classList.add("oculto");
    mostrarError("error-nombre", "");
    return true;
  }

  function entrarMesero() {
    var nombre = $("campo-mesero").value.trim();
    var nuevoPin = $("campo-pin-mesero").value.trim();
    if (!nombre) {
      mostrarError("error-nombre", "Escribe tu nombre para empezar.");
      $("campo-mesero").focus();
      return;
    }
    if (catalogo && catalogo.servidor && catalogo.servidor.relay && !nuevoPin) {
      mostrarError("error-nombre", "Escribe el código de acceso de meseros.");
      $("campo-pin-mesero").focus();
      return;
    }
    pin = nuevoPin;
    try {
      if (pin) sessionStorage.setItem(CLAVE_PIN, pin);
      else sessionStorage.removeItem(CLAVE_PIN);
    } catch (error) { /* opcional */ }
    usarMesero(nombre);
    if (sonido) POS.sonarAlerta();
    cargarCatalogo();
    cargarPendientes();
    window.scrollTo(0, 0);
  }

  function cambiarMesero() {
    $("campo-mesero").value = mesero;
    $("pantalla-nombre").classList.remove("oculto");
    mostrarError("error-nombre", "");
    setTimeout(function () {
      try {
        $("campo-mesero").focus();
        $("campo-mesero").select();
      } catch (error) { /* opcional */ }
    }, 60);
  }

  /* ================================================================== */
  /* Eventos                                                             */
  /* ================================================================== */
  function manejarClick(evento) {
    var boton = evento.target.closest("button[data-accion]");
    if (!boton) return;
    if (boton.dataset.accion === "aceptar") aceptar(boton.dataset.id, boton);
    else if (boton.dataset.accion === "rechazar") abrirRechazo(boton.dataset.id);
  }

  function enlazar() {
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-cerrar]"),
      function (boton) {
        boton.addEventListener("click", function () {
          POS.cerrarModal(boton.dataset.cerrar);
        });
      }
    );

    $("lista-pendientes").addEventListener("click", manejarClick);
    $("btn-confirmar-rechazo").addEventListener("click", confirmarRechazo);
    $("btn-entrar-mesero").addEventListener("click", entrarMesero);
    $("btn-cambiar-mesero").addEventListener("click", cambiarMesero);
    $("btn-sonido").addEventListener("click", function () {
      sonido = !sonido;
      guardar(CLAVE_SONIDO, sonido ? "1" : "0");
      refrescarBotonSonido();
      if (sonido) POS.sonarAlerta();
    });

    $("campo-mesero").addEventListener("keydown", function (evento) {
      if (evento.key === "Enter") {
        evento.preventDefault();
        entrarMesero();
      }
    });
    $("campo-pin-mesero").addEventListener("keydown", function (evento) {
      if (evento.key === "Enter") {
        evento.preventDefault();
        entrarMesero();
      }
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        cargarCatalogo();
        cargarPendientes();
      }
    });
  }

  function iniciar() {
    sonido = leer(CLAVE_SONIDO) !== "0";
    refrescarBotonSonido();
    enlazar();

    mesero = leer(CLAVE_NOMBRE);
    try { pin = sessionStorage.getItem(CLAVE_PIN) || ""; } catch (error) { pin = ""; }
    if (mesero) {
      usarMesero(mesero);
      $("campo-mesero").value = mesero;
      $("campo-pin-mesero").value = pin;
    } else {
      $("pantalla-nombre").classList.remove("oculto");
    }

    cargarCatalogo();
    cargarPendientes();
    setInterval(cargarCatalogo, 30000);
    setInterval(cargarPendientes, INTERVALO);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
