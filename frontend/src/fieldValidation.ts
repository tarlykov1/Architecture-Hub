/** User-facing validation complements authoritative API checks. */
export function flowPortError(value: string): string {
  const port = value.trim()
  if (!port) return ''
  if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    return 'Укажите один порт от 1 до 65535 либо оставьте поле пустым.'
  }
  return ''
}

/** A single IPv4/IPv6 address, optionally with a CIDR prefix. */
export function ipAddressError(value: string): string {
  const address = value.trim()
  if (!address) return ''
  const parts = address.split('/')
  const error = 'Введите корректный IPv4/IPv6-адрес, при необходимости с префиксом сети.'
  if (parts.length > 2 || !parts[0]) return error
  const host = parts[0]
  const ipv6 = host.includes(':')
  if (ipv6) {
    try {
      const parsed = new URL('http://[' + host + ']/')
      if (!parsed.hostname.startsWith('[')) return error
    } catch {
      return error
    }
  } else {
    const octets = host.split('.')
    if (octets.length !== 4 || octets.some(octet =>
      !/^(0|[1-9][0-9]{0,2})$/.test(octet) || Number(octet) > 255
    )) return error
  }
  if (parts.length === 2) {
    const prefix = parts[1]
    const max = ipv6 ? 128 : 32
    if (!/^(0|[1-9][0-9]*)$/.test(prefix) || Number(prefix) > max) return error
  }
  return ''
}
