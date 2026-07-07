//! DuckDB conformance (M2b.0(a) spike, kept as a permanent guard): proves the bundled DuckDB crate
//! compiles/links on this toolchain and does exactly what M2b.4's vector store relies on — CRUD, and
//! storing/returning `DOUBLE[]` vectors for brute-force cosine (D8 — no VSS extension). The FTS probe
//! records that the `fts` extension is NOT reliably available offline, confirming M2b.5 must
//! hand-roll its tokenizer/scoring (which it must anyway, to match `searchNotes` rather than
//! DuckDB's Porter/BM25 defaults).

#[cfg(test)]
mod tests {
  use duckdb::Connection;

  #[test]
  fn bundled_duckdb_compiles_and_does_crud() {
    let conn = Connection::open_in_memory().expect("open in-memory duckdb");
    conn
      .execute_batch("CREATE TABLE t(id TEXT PRIMARY KEY, n INTEGER);")
      .expect("create table");
    conn
      .execute("INSERT INTO t VALUES ('a', 1), ('b', 2)", [])
      .expect("insert");
    let sum: i64 = conn
      .query_row("SELECT sum(n) FROM t", [], |r| r.get(0))
      .expect("aggregate");
    assert_eq!(sum, 3);
  }

  /// A DuckDB `DOUBLE[]` column comes back as a `Value::List` of `Value::Double`; unpack to Vec<f64>.
  fn as_vec_f64(value: duckdb::types::Value) -> Vec<f64> {
    use duckdb::types::Value;
    match value {
      Value::List(items) => items
        .into_iter()
        .map(|v| match v {
          Value::Double(d) => d,
          Value::Float(f) => f as f64,
          _ => 0.0,
        })
        .collect(),
      _ => Vec::new(),
    }
  }

  #[test]
  fn stores_and_returns_float_vectors_for_brute_force_cosine() {
    let conn = Connection::open_in_memory().expect("open in-memory duckdb");
    conn
      .execute_batch(
        "CREATE TABLE vectors(note_id TEXT PRIMARY KEY, vec DOUBLE[]);
         INSERT INTO vectors VALUES ('a', [1.0, 0.0, 0.0]), ('b', [0.0, 1.0, 0.0]);",
      )
      .expect("create + insert vectors");

    let mut stmt = conn
      .prepare("SELECT note_id, vec FROM vectors ORDER BY note_id")
      .expect("prepare");
    let rows: Vec<(String, Vec<f64>)> = stmt
      .query_map([], |row| {
        Ok((row.get::<_, String>(0)?, as_vec_f64(row.get::<_, duckdb::types::Value>(1)?)))
      })
      .expect("query")
      .collect::<Result<_, _>>()
      .expect("collect");

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, "a");
    assert_eq!(rows[0].1, vec![1.0, 0.0, 0.0]); // vector stored + returned byte-exact

    // Brute-force dot product vs a query vector: 'a' must outscore 'b' for query [1,0,0].
    let query = [1.0f64, 0.0, 0.0];
    let dot = |v: &[f64]| v.iter().zip(query.iter()).map(|(a, b)| a * b).sum::<f64>();
    assert!(dot(&rows[0].1) > dot(&rows[1].1));
  }

  #[test]
  fn fts_extension_prefix_search_without_stemming() {
    // The other M2b.4/5 unknown: does the FTS extension load (statically bundled, offline) and can
    // it be configured stemmer='none' with prefix matching? Probe it; ignore if unavailable so the
    // spike still reports the CRUD/vector result.
    let conn = Connection::open_in_memory().expect("open");
    let loaded = conn
      .execute_batch("INSTALL fts; LOAD fts;")
      .and_then(|_| {
        conn.execute_batch(
          "CREATE TABLE docs(id TEXT, body TEXT);
           INSERT INTO docs VALUES ('n1', 'planning the roadmap'), ('n2', 'unrelated');
           PRAGMA create_fts_index('docs', 'id', 'body', stemmer='none', stopwords='none');",
        )
      });
    if loaded.is_err() {
      eprintln!("[spike] fts extension unavailable offline: {loaded:?} — M2b.5 must hand-roll FTS");
      return;
    }
    // If FTS loaded, a plain-token match should find n1 (prefix/tokenizer parity is M2b.5's job).
    let hit: i64 = conn
      .query_row(
        "SELECT count(*) FROM (SELECT *, fts_main_docs.match_bm25(id, 'planning') AS score FROM docs) WHERE score IS NOT NULL",
        [],
        |r| r.get(0),
      )
      .unwrap_or(0);
    eprintln!("[spike] fts loaded; 'planning' matched {hit} doc(s)");
  }
}
