import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// A limpeza automatica da testing-library depende de `globals: true`, que a
// suite nao usa. Sem este afterEach o DOM do teste anterior sobrevive e a
// consulta seguinte encontra dois de cada elemento.
afterEach(cleanup)
