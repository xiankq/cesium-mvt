declare module 'murmurhash-js' {
  function murmurhash(input: string, seed?: number): number

  export default murmurhash
  export function murmur3(input: string, seed?: number): number
  export function murmur2(input: string, seed?: number): number
}
