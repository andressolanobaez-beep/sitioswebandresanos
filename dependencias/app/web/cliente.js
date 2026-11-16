/* Caja Futurista · carta del cliente por QR: elige, pide y sigue el estado */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var CLAVE_PEDIDO = "pos_pedido_cliente";
  var CLAVE_PEDIDO_PENDIENTE = "pos_pedido_cliente_pendiente";
  var CLAVE_MESA = "pos_mesa_cliente";
  var INTERVALO = 3000;

  var catalogo = null;
  var carrito = POS.crearCarrito();
  var categoriaActiva = "";
  var pedidoId = "";
  var enviando = false;
  var reintentando = false;
  var temporizador = null;

  function guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (error) { /* opcional */ }
  }

  function guardarSolicitudPendiente(id, body) {
    try {
      localStorage.setItem(CLAVE_PEDIDO_PENDIENTE, JSON.stringify({ id: id, body: body }));
      localStorage.setItem(CLAVE_PEDIDO, id);
      return true;
    } catch (error) {
      return false;
    }
  }

  function leer(clave) {
    try { return localStorage.getItem(clave) || ""; } catch (error) { return ""; }
  }

  function borrar(clave) {
    try { localStorage.removeItem(clave); } catch (error) { /* opcional */ }
  }

  function nuevoIdPedido() {
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    }
    return (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, "0").slice(0, 32);
  }

  function pedidoPendienteGuardado() {
    try {
      var pendiente = JSON.parse(leer(CLAVE_PEDIDO_PENDIENTE));
      return pendiente && typeof pendiente.id === "string" &&
        pendiente.body && typeof pendiente.body === "object" ? pendiente : null;
    } catch (error) {
      return null;
    }
  }

  function dinero(valor) {
    return POS.dinero(valor, (catalogo && catalogo.moneda) || "$");
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
  /* Carga y marca                                                       */
  /* ================================================================== */
  async function cargarCatalogo() {
    try {
      var datos = await POS.pedirJSON("/api/catalogo");
      catalogo = datos;
      aplicarMarca();
      var tema = POS.temaGuardado() || (datos.marca && datos.marca.tema) || "futurista";
      POS.aplicarTema(tema, false);
      construirCategorias();
      renderPlatos();
      actualizarBarra();
    } catch (error) {
      POS.aviso("No se pudo cargar la carta. Revisa el WiFi.", "error", 5000);
    }
  }

  function aplicarMarca() {
    if (!catalogo) return;
    var marca = catalogo.marca || {};
    var negocio = marca.negocio || "CAJA FUTURISTA";
    document.title = "Carta del día · " + negocio;
    $("negocio-cliente").textContent = negocio;
    $("eslogan-cliente").textContent = marca.eslogan || "CARTA DEL DÍA · PIDE DESDE TU CELULAR";
    var titulo = marca.menu_titulo || "CARTA DEL DÍA";
    var nota = marca.menu_nota || "Toca los platos que quieras y pulsa PEDIR.";
    $("nota-cliente").textContent = titulo + " · " + nota;
    if (marca.aviso_cliente) $("aviso-cliente-pedido").textContent = marca.aviso_cliente;
  }

  function menu() {
    return (catalogo && catalogo.menu) || { items: [] };
  }

  function categorias() {
    var m = menu();
    if (Array.isArray(m.categorias) && m.categorias.length) return m.categorias;
    return (m.items || []).reduce(function (lista, item) {
      if (lista.indexOf(item.categoria) === -1) lista.push(item.categoria);
      return lista;
    }, []);
  }

  /* ================================================================== */
  /* Carta                                                               */
  /* ================================================================== */
  function construirCategorias() {
    var barra = $("categorias-cliente");
    var lista = categorias();
    if (!categoriaActiva || lista.indexOf(categoriaActiva) === -1) {
      categoriaActiva = lista[0] || "";
    }
    barra.innerHTML = lista.map(function (categoria) {
      var activa = categoria === categoriaActiva ? " activa" : "";
      return '<button type="button" class="boton categoria' + activa +
        '" data-categoria="' + POS.escapar(categoria) + '">' +
        POS.escapar(categoria || "OTROS") + "</button>";
    }).join("");
  }

  function htmlPlato(item) {
    var foto = item.imagen
      ? '<img class="plato-foto" alt="" loading="lazy" src="' + POS.urlImagen(item.imagen) + '">'
      : '<div class="plato-sin-foto">🍽</div>';
    var descripcion = item.descripcion
      ? "<small>" + POS.escapar(item.descripcion) + "</small>"
      : "";
    var acciones;
    if (item.disponible === false) {
      acciones = '<div class="agotado">AGOTADO POR HOY</div>';
    } else {
      var cantidad = carrito.cantidad(item.id);
      if (cantidad > 0) {
        acciones =
          '<div class="plato-acciones">' +
            '<div class="contador-carrito">' +
              '<button type="button" class="boton boton-paso mini" data-accion="restar" data-id="' +
                POS.escapar(item.id) + '" aria-label="Quitar uno">−</button>' +
              '<span class="cant">' + cantidad + "</span>" +
              '<button type="button" class="boton boton-paso mini" data-accion="sumar" data-id="' +
                POS.escapar(item.id) + '" aria-label="Agregar uno">+</button>' +
            "</div>" +
          "</div>";
      } else {
        acciones =
          '<div class="plato-acciones">' +
            '<button type="button" class="boton boton-primario" data-accion="sumar" data-id="' +
              POS.escapar(item.id) + '">AGREGAR</button>' +
          "</div>";
      }
    }
    return (
      '<article class="plato" data-id="' + POS.escapar(item.id) + '">' +
        foto +
        '<div class="plato-cuerpo">' +
          "<b>" + POS.escapar(item.nombre) + "</b>" +
          descripcion +
          '<span class="plato-precio">' + dinero(item.precio) + "</span>" +
        "</div>" +
        acciones +
      "</article>"
    );
  }

  function renderPlatos() {
    var contenedor = $("lista-platos");
    var articulos = (menu().items || []).filter(function (item) {
      return item.categoria === categoriaActiva;
    });
    if (!articulos.length) {
      contenedor.innerHTML =
        '<div class="vacio"><div class="icono">▤</div>' +
        '<div class="titulo-vacio">NADA EN ESTA CATEGORÍA</div>' +
        "<p>Prueba con otra categoría de la carta.</p></div>";
      return;
    }
    contenedor.innerHTML = articulos.map(htmlPlato).join("");
  }

  /* ================================================================== */
  /* Carrito                                                             */
  /* ================================================================== */
  function actualizarBarra() {
    var articulos = carrito.cantidadTotal();
    $("total-cliente").textContent = dinero(carrito.total());
    $("articulos-cliente").textContent =
      articulos + (articulos === 1 ? " artículo" : " artículos");
    var barra = $("barra-cliente");
    var visible = articulos > 0 && $("vista-estado").classList.contains("oculto");
    barra.classList.toggle("oculto", !visible);
    $("total-modal-cliente").textContent = dinero(carrito.total());
  }

  function cambiarCantidad(id, sumar) {
    var item = (menu().items || []).filter(function (i) { return i.id === id; })[0];
    if (sumar) {
      if (item && item.disponible !== false) carrito.agregar(item);
    } else {
      carrito.restar(id);
    }
    renderPlatos();
    actualizarBarra();
  }

  /* ================================================================== */
  /* Pedido                                                              */
  /* ================================================================== */
  function abrirPedido() {
    if (!carrito.cantidadTotal()) {
      POS.aviso("Agrega al menos un plato a tu pedido.");
      return;
    }
    mostrarError("error-cliente", "");
    POS.pintarCarrito($("carrito-cliente"), carrito, function () {
      actualizarBarra();
      if (!carrito.cantidadTotal()) POS.cerrarModal("modal-pedido-cliente");
    }, { moneda: (catalogo && catalogo.moneda) || "$", conNotas: true });

    var mesa = leer(CLAVE_MESA);
    $("campo-mesa-cliente").value = mesa || "";
    POS.abrirModal("modal-pedido-cliente", "#campo-mesa-cliente");
  }

  async function enviarPedido() {
    if (enviando) return;
    mostrarError("error-cliente", "");

    if (!carrito.cantidadTotal()) {
      mostrarError("error-cliente", "Tu pedido está vacío.");
      return;
    }
    var mesa = parseInt($("campo-mesa-cliente").value, 10);
    var total = (catalogo && catalogo.mesas_total) || 99;
    if (!isFinite(mesa) || mesa < 1) {
      mostrarError("error-cliente", "Escribe el número de tu mesa.");
      $("campo-mesa-cliente").focus();
      return;
    }
    if (mesa > total) {
      mostrarError("error-cliente", "El número de mesa no existe. Revisa el número que está en tu mesa.");
      return;
    }

    var contenido = {
      tipo: "mesa",
      mesa: mesa,
      items: carrito.lineas(),
      nota: $("nota-pedido-cliente").value.trim()
    };
    var pendienteAnterior = pedidoPendienteGuardado();
    var id = pendienteAnterior &&
      JSON.stringify(pendienteAnterior.body) === JSON.stringify(contenido)
      ? pendienteAnterior.id
      : nuevoIdPedido();
    var cuerpo = Object.assign({ id: id }, contenido);
    if (!guardarSolicitudPendiente(id, contenido)) {
      mostrarError(
        "error-cliente",
        "No se pudo guardar el pedido en este navegador. Libera espacio o habilita el almacenamiento y vuelve a intentar."
      );
      return;
    }

    enviando = true;
    var boton = $("btn-enviar-cliente");
    boton.disabled = true;
    boton.textContent = "ENVIANDO…";
    try {
      var datos = await POS.pedirJSON("/api/cliente/pedido", {
        method: "POST",
        body: cuerpo
      });
      guardar(CLAVE_MESA, String(mesa));
      pedidoId = datos.pedido.id;
      guardar(CLAVE_PEDIDO, pedidoId);
      if (datos.pedido.sincronizado) borrar(CLAVE_PEDIDO_PENDIENTE);
      carrito.vaciar();
      $("nota-pedido-cliente").value = "";
      POS.cerrarModal("modal-pedido-cliente");
      POS.aviso(
        datos.pedido.sincronizado
          ? "¡La caja recibió tu pedido! Espera a que un mesero lo acepte."
          : "Pedido en tránsito. Mantén esta página abierta hasta que la caja lo confirme.",
        datos.pedido.sincronizado ? "ok" : "aviso",
        6000
      );
      mostrarEstado(datos.pedido);
      iniciarSeguimiento();
    } catch (error) {
      mostrarError("error-cliente", error.message);
    } finally {
      enviando = false;
      boton.disabled = false;
      boton.textContent = "ENVIAR PEDIDO";
      actualizarBarra();
    }
  }

  /* ================================================================== */
  /* Estado del pedido                                                   */
  /* ================================================================== */
  var ESTADOS_VISTA = {
    sincronizando: {
      icono: "🔄",
      titulo: "ENVIANDO A LA CAJA",
      detalle: "Tu pedido sigue guardado temporalmente en este navegador. Mantén esta página abierta hasta que la caja lo confirme.",
      clase: "estado-espera"
    },
    pendiente: {
      icono: "⏳",
      titulo: "ESPERANDO QUE UN MESERO ACEPTE",
      detalle: "Tu pedido ya llegó a la caja. En cuanto un mesero lo acepte, irá a la cocina.",
      clase: "estado-espera"
    },
    abierto: {
      icono: "👨‍🍳",
      titulo: "¡TU PEDIDO ESTÁ EN COCINA!",
      detalle: "Un mesero aceptó tu pedido y la comanda ya se imprimió. Pronto lo llevamos a tu mesa.",
      clase: "estado-ok"
    },
    rechazado: {
      icono: "✕",
      titulo: "PEDIDO RECHAZADO",
      detalle: "No pudimos tomar tu pedido. Intenta de nuevo o llama al mesero.",
      clase: "estado-malo"
    },
    pagado: {
      icono: "✅",
      titulo: "PEDIDO PAGADO",
      detalle: "¡Gracias por tu visita! Esperamos verte pronto.",
      clase: "estado-ok"
    },
    cancelado: {
      icono: "✕",
      titulo: "PEDIDO CANCELADO",
      detalle: "Este pedido fue cancelado. Si fue un error, pide de nuevo.",
      clase: "estado-malo"
    }
  };

  function reciboHtml(pedido) {
    var filas = [
      ["PEDIDO", pedido.id],
      ["MESA", pedido.tipo === "llevar" ? "PARA LLEVAR" : POS.dosDigitos(pedido.mesa)],
      ["HORA", pedido.hora || ""],
      ["ESTADO", pedido.sincronizado === false ? "ENVIANDO A LA CAJA" : POS.estadoTexto(pedido.estado)]
    ];
    var items = (pedido.items || []).map(function (item) {
      return '<div class="fila"><span>' + Number(item.cantidad) + "× " +
        POS.escapar(item.nombre) + "</span><span>" +
        dinero(Number(item.precio) * Number(item.cantidad)) + "</span></div>";
    }).join("");
    return filas.map(function (fila) {
      return '<div class="fila"><span>' + fila[0] + "</span><span>" +
        POS.escapar(fila[1]) + "</span></div>";
    }).join("") +
      '<div class="fila" style="margin-top:5px;padding-top:5px;border-top:1px dashed var(--ventana-media)">' +
        "<span>DETALLE</span><span></span></div>" +
      items +
      '<div class="fila total"><span>TOTAL</span><span>' + dinero(pedido.total) + "</span></div>";
  }

  function mostrarEstado(pedido) {
    var vista = pedido.sincronizado === false ? ESTADOS_VISTA.sincronizando :
      (ESTADOS_VISTA[pedido.estado] || {
      icono: "⏳",
      titulo: POS.estadoTexto(pedido.estado),
      detalle: "",
      clase: ""
      });
    var icono = $("estado-icono");
    icono.textContent = vista.icono;
    icono.className = "estado-icono " + (vista.clase || "");
    var titulo = $("estado-titulo");
    titulo.textContent = vista.titulo;
    titulo.className = "estado-titulo " + (vista.clase || "");
    var detalle = vista.detalle;
    if (pedido.estado === "rechazado" && pedido.motivo_rechazo) {
      detalle = "Motivo: " + pedido.motivo_rechazo;
    }
    $("estado-detalle").textContent = detalle;
    $("estado-recibo").innerHTML = reciboHtml(pedido);
    $("btn-otro-pedido").disabled = pedido.sincronizado === false;

    $("vista-carta").classList.add("oculto");
    $("vista-estado").classList.remove("oculto");
    $("barra-cliente").classList.add("oculto");
    window.scrollTo(0, 0);
  }

  function mostrarCarta() {
    if (pedidoPendienteGuardado()) {
      POS.aviso("Espera la confirmación de la caja antes de iniciar otro pedido.", "aviso", 5000);
      return;
    }
    pedidoId = "";
    borrar(CLAVE_PEDIDO);
    borrar(CLAVE_PEDIDO_PENDIENTE);
    detenerSeguimiento();
    $("vista-estado").classList.add("oculto");
    $("vista-carta").classList.remove("oculto");
    carrito.vaciar();
    renderPlatos();
    actualizarBarra();
    window.scrollTo(0, 0);
  }

  function mostrarPedidoEnTransito(pendiente) {
    var body = pendiente.body || {};
    var items = body.items || [];
    var total = items.reduce(function (suma, item) {
      return suma + Number(item.precio || 0) * Number(item.cantidad || 0);
    }, 0);
    mostrarEstado({
      id: pendiente.id,
      estado: "pendiente",
      sincronizado: false,
      tipo: body.tipo || "mesa",
      mesa: body.mesa,
      items: items,
      total: total
    });
  }

  async function consultarEstado() {
    if (!pedidoId || reintentando) return;
    try {
      var datos = await POS.pedirJSON("/api/cliente/pedido/" + encodeURIComponent(pedidoId));
      if (datos.pedido.sincronizado) borrar(CLAVE_PEDIDO_PENDIENTE);
      mostrarEstado(datos.pedido);
      if (datos.pedido.estado === "rechazado" ||
          datos.pedido.estado === "cancelado" ||
          datos.pedido.estado === "pagado") {
        detenerSeguimiento();
      }
    } catch (error) {
      if (error.estado === 404) {
        var pendiente = pedidoPendienteGuardado();
        if (pendiente && pendiente.id === pedidoId) {
          reintentando = true;
          try {
            var reenviado = await POS.pedirJSON("/api/cliente/pedido", {
              method: "POST",
              body: Object.assign({ id: pendiente.id }, pendiente.body)
            });
            mostrarEstado(reenviado.pedido);
            if (reenviado.pedido.sincronizado) borrar(CLAVE_PEDIDO_PENDIENTE);
          } catch (errorReenvio) {
            if (errorReenvio.estado && errorReenvio.estado !== 503) {
              POS.aviso(errorReenvio.message, "error", 5000);
            }
          } finally {
            reintentando = false;
          }
        } else {
          borrar(CLAVE_PEDIDO);
          pedidoId = "";
          detenerSeguimiento();
          mostrarCarta();
          POS.aviso("Tu pedido anterior ya no está disponible. Puedes pedir de nuevo.", "error", 5000);
        }
      }
    }
  }

  function iniciarSeguimiento() {
    detenerSeguimiento();
    consultarEstado();
    temporizador = setInterval(consultarEstado, INTERVALO);
  }

  function detenerSeguimiento() {
    if (temporizador) {
      clearInterval(temporizador);
      temporizador = null;
    }
  }

  /* ================================================================== */
  /* Eventos                                                             */
  /* ================================================================== */
  function enlazar() {
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-cerrar]"),
      function (boton) {
        boton.addEventListener("click", function () {
          POS.cerrarModal(boton.dataset.cerrar);
        });
      }
    );

    $("categorias-cliente").addEventListener("click", function (evento) {
      var boton = evento.target.closest("button[data-categoria]");
      if (!boton) return;
      categoriaActiva = boton.dataset.categoria;
      construirCategorias();
      renderPlatos();
    });

    $("lista-platos").addEventListener("click", function (evento) {
      var boton = evento.target.closest("button[data-accion]");
      if (!boton) return;
      cambiarCantidad(boton.dataset.id, boton.dataset.accion === "sumar");
    });

    $("btn-pedir").addEventListener("click", abrirPedido);
    $("btn-enviar-cliente").addEventListener("click", enviarPedido);
    $("btn-otro-pedido").addEventListener("click", mostrarCarta);

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        cargarCatalogo();
        if (pedidoId) consultarEstado();
      }
    });
  }

  function iniciar() {
    enlazar();
    cargarCatalogo();
    setInterval(cargarCatalogo, 30000);

    pedidoId = leer(CLAVE_PEDIDO);
    if (pedidoId) {
      var pendiente = pedidoPendienteGuardado();
      if (pendiente && pendiente.id === pedidoId) mostrarPedidoEnTransito(pendiente);
      iniciarSeguimiento();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
