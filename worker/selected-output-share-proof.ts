/** Internal, complete selected-share proof queries. Each query preserves its
 * own native predicates and yields admitted=1 only while all of them hold.
 * These are server-authored SQL, never request data or transported authority.
 */
export type SelectedShareProofQuery = Readonly<{ sql: string; bindings: readonly (string | number | null)[] }>;

export function selectedShareProofQuery(sql: string, bindings: readonly (string | number | null)[]): SelectedShareProofQuery {
  return Object.freeze({ sql, bindings: Object.freeze([...bindings]) });
}

export function selectedSharePredicateProof(assertion: SelectedShareProofQuery): SelectedShareProofQuery {
  return selectedShareProofQuery(`SELECT 1 AS admitted WHERE (${assertion.sql})`, assertion.bindings);
}

/** Materialize sibling full proofs so SQLite does not recursively expand one
 * native authority query inside another. The caller executes this WITH clause
 * and every conjunct in the SAME final read or conditional write statement.
 * Bindings occur before the caller's statement bindings, in relation order.
 */
export function selectedShareProofStatement(proofs: readonly SelectedShareProofQuery[]) {
  if (proofs.length < 1 || proofs.length > 16) throw new Error("selected_output_share_proof_unavailable");
  return {
    withSql: `WITH ${proofs.map((proof, index) => `selected_share_proof_${index} AS MATERIALIZED (${proof.sql})`).join(",")}`,
    sql: proofs.map((_, index) => `EXISTS(SELECT 1 FROM selected_share_proof_${index} WHERE admitted=1)`).join(" AND "),
    bindings: proofs.flatMap(proof => [...proof.bindings]),
  };
}
