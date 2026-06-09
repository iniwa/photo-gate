/**
 * Minimal readable body contract for private object reads.
 * All stored metadata (Content-Type, ETag, size, upload timestamp, checksums, etc.)
 * is intentionally excluded; route-independent services must not trust or forward it.
 */
export interface PrivateObjectBody {
  /** Readable stream body, passable directly to new Response(). */
  readonly body: ReadableStream | null
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
