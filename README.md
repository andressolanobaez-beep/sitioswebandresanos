# Sitios web de Caja Futurista

Este servicio Render publica dos vistas en el mismo sitio:

- Clientes: <https://sitioswebandresanos.onrender.com/cliente>
- Meseros: <https://sitioswebandresanos.onrender.com/mesero>

El relay recibe la carta y los pedidos de la caja por HTTPS y retransmite las
acciones de clientes y meseros. La caja conserva los pedidos y pagos; Render
mantiene solo una copia temporal en memoria y no usa una base de datos.

## Configuracion

Render crea el servicio desde `render.yaml` y genera `RELAY_POS_TOKEN`
automáticamente. Al crear el Blueprint, define `RELAY_WAITER_PIN` con un valor
privado de al menos 6 caracteres. Ninguno de estos valores debe guardarse en
el repositorio.

En la caja, configura `informes\sistema\relay.json` con la URL publica y el
mismo token de `RELAY_POS_TOKEN`:

```json
{"url":"https://sitioswebandresanos.onrender.com","token":"TOKEN_PRIVADO"}
```

La caja debe estar encendida y conectada a internet para publicar la carta y
recibir pedidos. Si Render se reinicia, el relay recupera su estado al volver
a sincronizar con la caja.
