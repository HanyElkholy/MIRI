export function formatTimeDecimal(decimal) {
    if (!decimal && decimal !== 0) return "00:00";
    const isNegative = decimal < 0;
    const absDecimal = Math.abs(decimal);
    const hours = Math.floor(absDecimal);
    const minutes = Math.round((absDecimal - hours) * 60);
    const hStr = hours.toString().padStart(2, '0');
    const mStr = minutes.toString().padStart(2, '0');
    return (isNegative ? "-" : "") + `${hStr}:${mStr}`;
}

export function timeToDec(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
}

export function decToTime(d) {
    const h = Math.floor(Math.abs(d));
    const m = Math.round((Math.abs(d) - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function calcPause(brutto) {
    return Math.floor(brutto / 6) * 0.5;
}
