import { uuidv7 } from 'uuidv7'

/** UUIDv7: o timestamp mora nos bits mais significativos, entao ordenar por id
 *  e ordenar por tempo. E o que permite paginar sem OFFSET. */
export function newId(): string {
  return uuidv7()
}
