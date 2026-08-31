/**
 * Minimal readable body contract for private object reads.
 * Stored metadata is intentionally excluded except the byte length. The byte
 * length is used only to reject oversized JSON before buffering it; it is never
 * rendered or forwarded in an HTTP response.
 */
export interface PrivateObjectBody {
  /** Readable stream body, passable directly to new Response(). */
  readonly body: ReadableStream | null
  /** Optional object byte length used only for bounded manifest reads. */
  readonly size?: number
  /** Reads the full object content as a UTF-8 string (for manifest parsing only). */
  text(): Promise<string>
}

/**
 * Injected contract for reading private objects from the backing store.
 * The backing store type (R2Bucket or otherwise) is not part of this contract.
 * The R2 binding name is not yet decided; this stays injected and decoupled from wrangler.toml.
 */
export interface PrivateObjectReader {
  get(key: string): Promise<PrivateObjectBody | null>
}
