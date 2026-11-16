// Tipo de dispositivo. TOUCH = pantalla tactil como entrada principal (movil o tableta): se muestran los controles
// en pantalla y se usa el preset grafico ligero. En ordenador (raton) todo sigue igual.
// La deteccion vive en utils/deviceProfile.js (perfil desktop / tablet / mobile, clases en <html>).
// Forzar para probar: ?touch=1 (o ?touch=0 para desactivarlo en una tableta con raton), ?device=mobile|tablet|desktop.
import { device } from "./utils/deviceProfile.js";

export { device };
export const TOUCH = device.isTouchUI;
