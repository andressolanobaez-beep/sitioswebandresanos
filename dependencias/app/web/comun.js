/* Caja Futurística · utilidades compartidas por la caja, los meseros y los clientes */
(function () {
  "use strict";

  var POS = (window.POS = window.POS || {});
  var DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  var MESES = [
    "ene", "feb", "mar", "abr", "may", "jun",
    "jul", "ago", "sep", "oct", "nov", "dic"
  ];
  var TEMA_CLAVE = "pos_tema";
  var TEMA_POR_DEFECTO = "futurista";

  POS.NOMBRES_TEMA = {
    futurista: "FUTURISTA",
    oscuro: "OSCURO",
    claro: "CLARO",
    retro: "RETRO",
    matrix: "MATRIX"
  };

  POS.ESTADOS_TEXTO = {
    pendiente: "POR ACEPTAR",
    abierto: "EN MESA",
    rechazado: "RECHAZADO",
    pagado: "PAGADO",
    cancelado: "CANCELADO"
  };

  /* ------------------------------------------------------------------ */
  /* Formato                                                             */
  /* ------------------------------------------------------------------ */
  POS.dinero = function (valor, moneda) {
    var simbolo = moneda || "$";
    var numero = Number(valor);
    if (!isFinite(numero)) numero = 0;
    return simbolo + numero.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  POS.escapar = function (texto) {
    return String(texto === null || texto === undefined ? "" : texto).replace(
      /[&<>"']/g,
      function (caracter) {
        return {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[caracter];
      }
    );
  };

  POS.dosDigitos = function (numero) {
    return String(numero).padStart(2, "0");
  };

  POS.horaDe = function (iso) {
    var fecha = new Date(iso);
    if (isNaN(fecha.getTime())) return "--:--:--";
    return POS.dosDigitos(fecha.getHours()) + ":" +
      POS.dosDigitos(fecha.getMinutes()) + ":" +
      POS.dosDigitos(fecha.getSeconds());
  };

  POS.minutosDesde = function (iso) {
    var fecha = new Date(iso);
    if (isNaN(fecha.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / 60000));
  };

  POS.hace = function (iso) {
    var minutos = POS.minutosDesde(iso);
    if (minutos < 1) return "AHORA";
    if (minutos < 60) return minutos + " MIN";
    var horas = Math.floor(minutos / 60);
    var resto = minutos % 60;
    return horas + "h " + POS.dosDigitos(resto) + "m";
  };

  POS.destinoTexto = function (pedido) {
    if (!pedido) return "—";
    if (pedido.tipo === "llevar") return "PARA LLEVAR";
    var numero = Number(pedido.mesa);
    if (!isFinite(numero)) return "MESA —";
    return "MESA " + POS.dosDigitos(numero);
  };

  POS.estadoTexto = function (estado) {
    return POS.ESTADOS_TEXTO[estado] || String(estado || "").toUpperCase();
  };

  POS.montarReloj = function (elementoHora, elementoFecha) {
    function actualizar() {
      var ahora = new Date();
      if (elementoHora) {
        elementoHora.textContent =
          POS.dosDigitos(ahora.getHours()) + ":" +
          POS.dosDigitos(ahora.getMinutes()) + ":" +
          POS.dosDigitos(ahora.getSeconds());
      }
      if (elementoFecha) {
        elementoFecha.textContent =
          DIAS[ahora.getDay()] + " " +
          POS.dosDigitos(ahora.getDate()) + " " +
          MESES[ahora.getMonth()] + " " +
          ahora.getFullYear();
      }
    }
    actualizar();
    return setInterval(actualizar, 1000);
  };

  /* ------------------------------------------------------------------ */
  /* Temas                                                               */
  /* ------------------------------------------------------------------ */
  POS.aplicarTema = function (tema, guardarEnCache) {
    tema = String(tema || TEMA_POR_DEFECTO).toLowerCase();
    if (!POS.NOMBRES_TEMA[tema]) tema = TEMA_POR_DEFECTO;
    document.body.setAttribute("data-theme", tema);
    if (guardarEnCache !== false) {
      try { localStorage.setItem(TEMA_CLAVE, tema); } catch (error) {}
    }
    return tema;
  };

  POS.temaGuardado = function () {
    try { return localStorage.getItem(TEMA_CLAVE) || ""; } catch (error) { return ""; }
  };

  POS.montarSelectorTema = function (select, temas, actual, alCambiar) {
    if (!select) return;
    var lista = (temas && temas.length) ? temas : [TEMA_POR_DEFECTO];
    select.textContent = "";
    lista.forEach(function (tema) {
      var opcion = document.createElement("option");
      opcion.value = tema;
      opcion.textContent = POS.NOMBRES_TEMA[tema] || String(tema).toUpperCase();
      select.appendChild(opcion);
    });
    if (actual && lista.indexOf(actual) !== -1) select.value = actual;
    select.addEventListener("change", function () {
      POS.aplicarTema(select.value);
      if (typeof alCambiar === "function") alCambiar(select.value);
    });
  };

  /* ------------------------------------------------------------------ */
  /* Avisos y diálogos                                                   */
  /* ------------------------------------------------------------------ */
  POS.aviso = function (texto, tipo, milisegundos) {
    var nodo = document.getElementById("aviso-pos");
    if (!nodo) {
      nodo = document.createElement("div");
      nodo.id = "aviso-pos";
      document.body.appendChild(nodo);
    }
    nodo.className = "aviso" + (tipo === "ok" ? " ok" : tipo === "error" ? " error" : "");
    nodo.textContent = texto;
    clearTimeout(POS._avisoTimer);
    POS._avisoTimer = setTimeout(function () {
      if (nodo.parentNode) nodo.remove();
    }, milisegundos || 3800);
  };

  POS.abrirModal = function (identificador, selectorEnfoque) {
    var modal = typeof identificador === "string"
      ? document.getElementById(identificador)
      : identificador;
    if (!modal) return;
    modal.classList.remove("oculto");
    document.body.classList.add("con-modal");
    var objetivo = selectorEnfoque
      ? modal.querySelector(selectorEnfoque)
      : modal.querySelector("[autofocus], input:not([type=hidden]), textarea, select, .boton-primario");
    if (objetivo) {
      setTimeout(function () {
        try { objetivo.focus(); objetivo.select && objetivo.select(); } catch (e) {}
      }, 40);
    }
  };

  POS.cerrarModal = function (identificador) {
    var modal = typeof identificador === "string"
      ? document.getElementById(identificador)
      : identificador;
    if (!modal) return;
    modal.classList.add("oculto");
    var abiertos = document.querySelectorAll(".modal-fondo:not(.oculto)");
    if (!abiertos.length) {
      document.body.classList.remove("con-modal");
    }
  };

  document.addEventListener("keydown", function (evento) {
    if (evento.key !== "Escape") return;
    var abiertos = Array.prototype.slice.call(
      document.querySelectorAll(".modal-fondo:not(.oculto)")
    ).filter(function (modal) {
      return modal.dataset.dinamico !== "1";
    });
    if (abiertos.length) {
      evento.preventDefault();
      POS.cerrarModal(abiertos[abiertos.length - 1]);
    }
  });

  document.addEventListener("click", function (evento) {
    if (evento.target.classList.contains("modal-fondo") &&
        evento.target.dataset.estatico !== "1" &&
        evento.target.dataset.dinamico !== "1") {
      POS.cerrarModal(evento.target);
    }
  });

  POS.confirmar = function (opciones) {
    opciones = opciones || {};
    return new Promise(function (resolver) {
      var fondo = document.createElement("div");
      fondo.className = "modal-fondo modal-confirmacion";
      fondo.dataset.dinamico = "1";
      fondo.innerHTML =
        '<div class="ventana modal" role="dialog" aria-modal="true">' +
          '<div class="barra-titulo"><span class="icono-titulo">?</span>' +
            '<span class="titulo-ventana">' + POS.escapar(opciones.titulo || "CONFIRMAR") + "</span>" +
            '<span class="botones-titulo"><button type="button" class="boton-titulo" data-cerrar>×</button></span>' +
          "</div>" +
          '<div class="modal-cuerpo"><p class="confirmar-mensaje">' +
            POS.escapar(opciones.mensaje || "") +
          "</p></div>" +
          '<div class="modal-pie">' +
            '<button type="button" class="boton" data-cancelar>' +
              POS.escapar(opciones.textoCancelar || "CANCELAR") +
            "</button>" +
            '<button type="button" class="boton ' +
              (opciones.peligro ? "boton-peligro" : "boton-primario") +
              '" data-ok>' + POS.escapar(opciones.textoOk || "ACEPTAR") + "</button>" +
          "</div>" +
        "</div>";
      document.body.appendChild(fondo);

      function cerrar(valor) {
        document.removeEventListener("keydown", alTeclear);
        fondo.remove();
        resolver(valor);
      }
      function alTeclear(evento) {
        if (evento.key === "Escape") {
          evento.preventDefault();
          cerrar(false);
        }
      }

      fondo.querySelector("[data-ok]").addEventListener("click", function () { cerrar(true); });
      fondo.querySelector("[data-cancelar]").addEventListener("click", function () { cerrar(false); });
      fondo.querySelector("[data-cerrar]").addEventListener("click", function () { cerrar(false); });
      fondo.addEventListener("click", function (evento) {
        if (evento.target === fondo) cerrar(false);
      });
      document.addEventListener("keydown", alTeclear);
      setTimeout(function () {
        var boton = fondo.querySelector("[data-ok]");
        if (boton) boton.focus();
      }, 30);
    });
  };

  POS.pedirJSON = async function (url, opciones) {
    var configuracion = Object.assign({}, opciones || {});
    configuracion.headers = Object.assign(
      { "Content-Type": "application/json" },
      (opciones && opciones.headers) || {}
    );
    if (configuracion.body && typeof configuracion.body !== "string") {
      configuracion.body = JSON.stringify(configuracion.body);
    }

    var respuesta;
    try {
      respuesta = await fetch(url, configuracion);
    } catch (error) {
      var sinRed = new Error("Sin conexión con la caja.");
      sinRed.estado = 0;
      throw sinRed;
    }

    var datos = null;
    try { datos = await respuesta.json(); } catch (error) { datos = null; }

    if (respuesta.status === 401) {
      if (window.location.pathname === "/caja" || window.location.pathname === "/caja/") {
        window.location.href = "/";
      }
      var expirada = new Error("La sesión expiró. Vuelve a entrar.");
      expirada.estado = 401;
      throw expirada;
    }
    if (!respuesta.ok) {
      var fallo = new Error(
        datos && datos.error ? datos.error : "Error " + respuesta.status
      );
      fallo.estado = respuesta.status;
      throw fallo;
    }
    return datos;
  };

  POS.copiar = async function (texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (error) {
      try {
        var area = document.createElement("textarea");
        area.value = texto;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var correcto = document.execCommand("copy");
        area.remove();
        return correcto;
      } catch (fallo) {
        return false;
      }
    }
  };

  POS.sonarAlerta = function () {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!POS._audio) POS._audio = new AudioCtx();
      var audio = POS._audio;
      if (audio.state === "suspended") audio.resume();
      [0, 0.17].forEach(function (retraso, indice) {
        var oscilador = audio.createOscillator();
        var ganancia = audio.createGain();
        oscilador.type = "square";
        oscilador.frequency.value = indice ? 1180 : 880;
        var inicio = audio.currentTime + retraso;
        ganancia.gain.setValueAtTime(0.0001, inicio);
        ganancia.gain.exponentialRampToValueAtTime(0.07, inicio + 0.012);
        ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.13);
        oscilador.connect(ganancia);
        ganancia.connect(audio.destination);
        oscilador.start(inicio);
        oscilador.stop(inicio + 0.15);
      });
    } catch (error) {
      /* el sonido es opcional */
    }
  };

  /* ------------------------------------------------------------------ */
  /* Carrito                                                             */
  /* ------------------------------------------------------------------ */
  POS.crearCarrito = function () {
    var lineas = new Map();

    function obtener(id) {
      return lineas.get(id) || null;
    }

    return {
      agregar: function (articulo) {
        var actual = lineas.get(articulo.id);
        if (actual) {
          actual.cantidad += 1;
        } else {
          lineas.set(articulo.id, {
            id: articulo.id,
            nombre: articulo.nombre,
            precio: Number(articulo.precio) || 0,
            cantidad: 1,
            nota: ""
          });
        }
      },
      sumar: function (id) {
        var actual = lineas.get(id);
        if (actual) actual.cantidad += 1;
      },
      restar: function (id) {
        var actual = lineas.get(id);
        if (!actual) return;
        actual.cantidad -= 1;
        if (actual.cantidad <= 0) lineas.delete(id);
      },
      quitar: function (id) {
        lineas.delete(id);
      },
      ponerNota: function (id, texto) {
        var actual = lineas.get(id);
        if (actual) actual.nota = String(texto || "");
      },
      obtener: obtener,
      cantidad: function (id) {
        var actual = lineas.get(id);
        return actual ? actual.cantidad : 0;
      },
      cantidadTotal: function () {
        var total = 0;
        lineas.forEach(function (linea) { total += linea.cantidad; });
        return total;
      },
      total: function () {
        var total = 0;
        lineas.forEach(function (linea) {
          total += linea.precio * linea.cantidad;
        });
        return Math.round(total * 100) / 100;
      },
      lineas: function () {
        return Array.from(lineas.values()).map(function (linea) {
          return {
            id: linea.id,
            nombre: linea.nombre,
            precio: linea.precio,
            cantidad: linea.cantidad,
            nota: linea.nota
          };
        });
      },
      vaciar: function () {
        lineas.clear();
      }
    };
  };

  POS.urlImagen = function (nombre) {
    return "/api/imagen/" + encodeURIComponent(nombre);
  };

  POS.crearSelector = function (raiz, menu, carrito, alCambiar, opciones) {
    if (!raiz || !menu || !Array.isArray(menu.items)) return { refrescar: function () {} };
    opciones = opciones || {};
    var moneda = opciones.moneda || "$";
    var conFotos = opciones.conFotos === true;
    var categorias = Array.isArray(menu.categorias) && menu.categorias.length
      ? menu.categorias
      : menu.items.reduce(function (lista, item) {
          if (lista.indexOf(item.categoria) === -1) lista.push(item.categoria);
          return lista;
        }, []);
    var activa = categorias[0];
    var barraCategorias = document.createElement("div");
    var lista = document.createElement("div");
    barraCategorias.className = "categorias";
    lista.className = "menu-lista";
    raiz.textContent = "";
    raiz.appendChild(barraCategorias);
    raiz.appendChild(lista);

    function dibujarCategorias() {
      barraCategorias.textContent = "";
      categorias.forEach(function (categoria) {
        var boton = document.createElement("button");
        boton.type = "button";
        boton.className = "categoria" + (categoria === activa ? " activa" : "");
        boton.textContent = categoria;
        boton.addEventListener("click", function () {
          activa = categoria;
          dibujarCategorias();
          dibujarLista();
        });
        barraCategorias.appendChild(boton);
      });
    }

    function actualizarFila(id) {
      var selectorId = window.CSS && CSS.escape ? CSS.escape(id) : id;
      var fila = lista.querySelector('[data-id="' + selectorId + '"]');
      if (!fila) return;
      var cantidad = fila.querySelector(".cantidad");
      if (cantidad) cantidad.textContent = carrito.cantidad(id);
    }

    function dibujarLista() {
      lista.textContent = "";
      var articulos = menu.items.filter(function (item) {
        return item.categoria === activa;
      });
      if (!articulos.length) {
        var vacio = document.createElement("div");
        vacio.className = "carrito-vacio";
        vacio.textContent = "No hay artículos en esta categoría.";
        lista.appendChild(vacio);
        return;
      }
      articulos.forEach(function (item) {
        var fila = document.createElement("div");
        fila.className = "menu-item";
        fila.dataset.id = item.id;
        var cantidad = carrito.cantidad(item.id);
        var descripcion = item.descripcion
          ? '<small>' + POS.escapar(item.descripcion) + "</small>"
          : "";
        var foto = "";
        if (conFotos && item.imagen) {
          foto = '<img class="menu-foto" alt="" loading="lazy" src="' +
            POS.urlImagen(item.imagen) + '">';
        }
        var derecha;
        if (item.disponible === false) {
          derecha = '<span class="agotado">AGOTADO</span>';
        } else {
          derecha =
            '<span class="menu-precio">' + POS.dinero(item.precio, moneda) + "</span>" +
            '<div class="contador">' +
              '<button type="button" class="boton boton-paso" data-accion="restar" aria-label="Quitar uno">−</button>' +
              '<span class="cantidad">' + cantidad + "</span>" +
              '<button type="button" class="boton boton-paso" data-accion="sumar" aria-label="Agregar uno">+</button>' +
            "</div>";
        }
        fila.innerHTML =
          foto +
          '<div class="menu-info"><b>' + POS.escapar(item.nombre) + "</b>" + descripcion + "</div>" +
          derecha;
        lista.appendChild(fila);
      });
    }

    lista.addEventListener("click", function (evento) {
      var boton = evento.target.closest("button[data-accion]");
      if (!boton) return;
      var fila = boton.closest(".menu-item");
      if (!fila) return;
      var id = fila.dataset.id;
      if (boton.dataset.accion === "sumar") {
        var articulo = menu.items.find(function (item) { return item.id === id; });
        if (articulo && articulo.disponible !== false) carrito.agregar(articulo);
      } else {
        carrito.restar(id);
      }
      actualizarFila(id);
      if (typeof alCambiar === "function") alCambiar();
    });

    dibujarCategorias();
    dibujarLista();

    return {
      refrescar: function () {
        dibujarCategorias();
        dibujarLista();
      },
      irA: function (categoria) {
        if (categorias.indexOf(categoria) !== -1) {
          activa = categoria;
          dibujarCategorias();
          dibujarLista();
        }
      }
    };
  };

  POS.pintarCarrito = function (contenedor, carrito, alCambiar, opciones) {
    if (!contenedor) return;
    opciones = opciones || {};
    var moneda = opciones.moneda || "$";
    var conNotas = opciones.conNotas !== false;

    contenedor._posCarrito = carrito;
    contenedor._posAlCambiar = alCambiar;

    function dibujar() {
      var actual = contenedor._posCarrito;
      var lineas = actual ? actual.lineas() : [];
      contenedor.textContent = "";
      if (!lineas.length) {
        var vacio = document.createElement("div");
        vacio.className = "carrito-vacio";
        vacio.innerHTML = "El carrito está vacío.<br>Toca <b>+</b> en un artículo para agregarlo.";
        contenedor.appendChild(vacio);
        return;
      }
      lineas.forEach(function (linea) {
        var fila = document.createElement("div");
        fila.className = "carrito-linea";
        fila.dataset.id = linea.id;
        fila.innerHTML =
          '<div class="contador-carrito">' +
            '<button type="button" class="boton boton-paso mini" data-accion="restar" aria-label="Quitar uno">−</button>' +
            '<span class="cant">' + linea.cantidad + "</span>" +
            '<button type="button" class="boton boton-paso mini" data-accion="sumar" aria-label="Agregar uno">+</button>' +
          "</div>" +
          '<div class="nombre">' + POS.escapar(linea.nombre) + "</div>" +
          '<span class="importe">' + POS.dinero(linea.precio * linea.cantidad, moneda) + "</span>" +
          '<button type="button" class="quitar" data-accion="quitar" aria-label="Quitar del pedido">×</button>' +
          (conNotas
            ? '<input class="nota" type="text" maxlength="120" data-nota placeholder="Nota para cocina (sin cebolla, término medio…)" value="' +
              POS.escapar(linea.nota) + '">'
            : "");
        contenedor.appendChild(fila);
      });
    }

    if (contenedor.dataset.posCarritoListo !== "1") {
      contenedor.dataset.posCarritoListo = "1";

      contenedor.addEventListener("click", function (evento) {
        var boton = evento.target.closest("button[data-accion]");
        if (!boton) return;
        var actual = contenedor._posCarrito;
        if (!actual) return;
        var fila = boton.closest(".carrito-linea");
        if (!fila) return;
        var id = fila.dataset.id;
        var accion = boton.dataset.accion;
        if (accion === "quitar") actual.quitar(id);
        else if (accion === "sumar") actual.sumar(id);
        else actual.restar(id);
        dibujar();
        if (typeof contenedor._posAlCambiar === "function") contenedor._posAlCambiar();
      });

      contenedor.addEventListener("input", function (evento) {
        var campo = evento.target.closest("input[data-nota]");
        if (!campo) return;
        var actual = contenedor._posCarrito;
        if (!actual) return;
        var fila = campo.closest(".carrito-linea");
        if (fila) actual.ponerNota(fila.dataset.id, campo.value);
      });
    }

    dibujar();
    return { refrescar: dibujar };
  };
})();
