// Contagem de tempo em horas úteis, conforme o expediente definido em
// config.js. Funções puras.

import { EXPEDIENTE } from "./config.js";

const HORA = 3600;
const DIA = 86400;

// Segundos de expediente entre dois instantes (em segundos desde 1970).
// O que ocorre fora do expediente não conta: um lead que chega na sexta às
// 19h e é atendido na segunda às 9h soma uma hora.
export function segundosUteis(inicioTs, fimTs, expediente = EXPEDIENTE) {
  if (!(fimTs > inicioTs)) return 0;
  // Desloca para o fuso do escritório, para que os dias comecem à meia-noite local.
  const deslocamento = expediente.fusoEmHoras * HORA;
  const inicio = inicioTs + deslocamento;
  const fim = fimTs + deslocamento;

  let total = 0;
  for (let dia = Math.floor(inicio / DIA) * DIA; dia < fim; dia += DIA) {
    const diaDaSemana = new Date(dia * 1000).getUTCDay();
    if (!expediente.diasDaSemana.includes(diaDaSemana)) continue;
    const abre = dia + expediente.horaDeInicio * HORA;
    const fecha = dia + expediente.horaDeFim * HORA;
    const de = Math.max(inicio, abre);
    const ate = Math.min(fim, fecha);
    if (ate > de) total += ate - de;
  }
  return Math.round(total);
}
