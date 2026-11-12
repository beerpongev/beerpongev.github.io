/** Gemeinsamer Transaktionspfad für die App und die Browser-Integrationstests. */
export async function runStateTransaction(api, db, ref, uid, transform, expectedRevision, { id, baseline, match } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let readRevision;
    try {
      return await api.runTransaction(db, async tx => {
        const snapshot = await tx.get(ref);
        const state = snapshot.exists() ? snapshot.data() : null;
        readRevision = state?.revision;
        if (expectedRevision !== undefined && state?.revision !== expectedRevision)
          throw new Error('Der Turnierstand wurde zwischenzeitlich geändert. Bitte erneut versuchen.');
        if (id && (JSON.stringify(state?.results[id] ?? null) !== baseline || JSON.stringify(state?.matches[id]) !== match))
          throw new Error('Dieses Spiel wurde zwischenzeitlich geändert. Bitte erneut öffnen.');
        const next = transform(state);
        if (id) { next.results[id].by = uid; next.results[id].at = Date.now(); }
        next.revision = (state?.revision ?? -1) + 1;
        next.updatedAt = api.serverTimestamp(); next.updatedBy = uid;
        tx.set(ref, next);
      });
    } catch (error) {
      // Bei konkurrierenden Ganzdokument-Transaktionen kann die Regelprüfung
      // einen veralteten Schreibversuch schon vor der SDK-Konflikterkennung
      // ablehnen. Nur bei nachgewiesenem Revisionswechsel frisch lesen/rechnen.
      // Echte Berechtigungsfehler werden unverändert weitergereicht.
      if (error.code !== 'permission-denied' || attempt === 2 || readRevision === undefined) throw error;
      const latest = await api.getDocFromServer(ref);
      if (!latest.exists() || latest.data().revision === readRevision) throw error;
    }
  }
}
