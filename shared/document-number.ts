/** Display only: IDs remain the keys for links, relations and provider metadata. */
export function documentNumber(document: { id?: string; documentNumber?: string } | null | undefined): string {
  return document?.documentNumber || document?.id || "";
}
