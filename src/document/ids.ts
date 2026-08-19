/**
 * Düğüm id üretimi — tecof-theme-editor `engine/ids.ts` ile aynı (nanoid/non-secure, 8).
 *
 * Alfabe `A-Za-z0-9_-`; ':' içeremez çünkü zone anahtarı `"<parentId>:<slot>"`
 * biçiminde ayrıştırılır. non-secure yeterli: id'ler güvenlik değil, tekillik için.
 */

import { nanoid } from "nanoid/non-secure";

export const ID_LENGTH = 8;
const ID_RE = /^[A-Za-z0-9_-]+$/;

export const generateId = (): string => nanoid(ID_LENGTH);

/** Doküman içinde geçerli bir id mi? (boş değil, ':' yok, alfabe dışı karakter yok) */
export function isValidNodeId(id: unknown): id is string {
    return typeof id === "string" && id.length > 0 && ID_RE.test(id);
}

/**
 * Verilen kümeyle çakışmayan yeni id üretir ve kümeye ekler. Çakışma olasılığı
 * 64^8'de bir ama doküman büyüdükçe "asla olmaz" demek yerine kontrol ediyoruz.
 */
export function uniqueId(used: Set<string>): string {
    let id = generateId();
    while (used.has(id)) id = generateId();
    used.add(id);
    return id;
}
