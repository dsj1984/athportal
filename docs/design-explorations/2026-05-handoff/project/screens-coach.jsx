/* Coach-persona screens: Roster, Verify-stat flow with modal.
   Exposes: CoachRoster, CoachVerify */

const RosterRow = ({ a, even }) => (
  <tr style={{ background: even ? "var(--color-surface-card)" : "color-mix(in srgb, var(--color-surface-hover) 50%, white)" }}>
    <td style={{ padding: "10px 14px" }}>
      <div className="row gap-3">
        <Avatar name={a.name} size={32} hue={a.hue} />
        <div className="col" style={{ minWidth: 0 }}>
          <div className="row gap-2"><span className="strong small">{a.name}</span>{a.verified && <VerifiedTick size={11} />}</div>
          <span className="tiny muted">{a.email}</span>
        </div>
      </div>
    </td>
    <td style={{ padding: "10px 14px" }}><span className="display strong" style={{ background: "var(--color-surface-hover)", padding: "2px 8px", borderRadius: 6 }}>#{a.num}</span></td>
    <td style={{ padding: "10px 14px" }} className="small">{a.pos}</td>
    <td style={{ padding: "10px 14px" }} className="small">{a.year}</td>
    <td style={{ padding: "10px 14px" }} className="small mono">{a.gpa}</td>
    <td style={{ padding: "10px 14px" }}>
      <div className="row gap-1">
        {a.invite === "accepted" && <Badge tone="lime" dot>Active</Badge>}
        {a.invite === "pending" && <Badge tone="amber" dot>Invite pending</Badge>}
        {a.invite === "needs" && <Badge tone="coral" dot>Needs profile</Badge>}
      </div>
    </td>
    <td style={{ padding: "10px 14px" }} className="small">
      <div className="row gap-1">
        <span className="strong">{a.pending}</span>
        <span className="muted">/ {a.pending + a.verified_count}</span>
        {a.pending > 0 && <Badge tone="amber">{a.pending} to verify</Badge>}
      </div>
    </td>
    <td style={{ padding: "10px 14px", textAlign: "right" }}>
      <button className="btn ghost sm" style={{ height: 28 }}>{I.dots}</button>
    </td>
  </tr>
);

const CoachRoster = () => {
  const athletes = [
    { name: "Maya Castellanos", email: "maya.c@bayview.fc", num: "9",  pos: "Forward (CF)", year: "2027", gpa: "3.92", invite: "accepted", verified: true, pending: 2, verified_count: 14, hue: 270 },
    { name: "Lily Ahn",         email: "lily.a@bayview.fc", num: "11", pos: "Winger (RW)",  year: "2027", gpa: "3.78", invite: "accepted", verified: true, pending: 0, verified_count: 12, hue: 200 },
    { name: "Sara Okafor",      email: "sara.o@bayview.fc", num: "10", pos: "Midfielder (CAM)", year: "2026", gpa: "3.65", invite: "accepted", verified: true, pending: 3, verified_count: 18, hue: 300 },
    { name: "Jess Park",        email: "jess.p@bayview.fc", num: "7",  pos: "Winger (LW)",  year: "2027", gpa: "3.82", invite: "accepted", verified: true, pending: 1, verified_count: 11, hue: 30  },
    { name: "Emma Wright",      email: "emma.w@bayview.fc", num: "5",  pos: "Defender (CB)", year: "2027", gpa: "3.45", invite: "accepted", verified: true, pending: 0, verified_count: 9,  hue: 140 },
    { name: "Priya Shah",       email: "priya.s@bayview.fc", num: "4", pos: "Defender (CB)", year: "2028", gpa: "3.91", invite: "accepted", verified: true, pending: 1, verified_count: 8,  hue: 340 },
    { name: "Kara Lin",         email: "kara.l@bayview.fc", num: "1",  pos: "Goalkeeper",   year: "2027", gpa: "3.55", invite: "accepted", verified: true, pending: 0, verified_count: 10, hue: 60  },
    { name: "Daniela Ortiz",    email: "d.ortiz@new.fc",    num: "—",  pos: "Defender (RB)", year: "2028", gpa: "—",     invite: "pending",  verified: false, pending: 0, verified_count: 0,  hue: 230 },
    { name: "Hannah Reeves",    email: "h.reeves@new.fc",   num: "—",  pos: "Midfielder",   year: "2027", gpa: "—",     invite: "needs",    verified: false, pending: 0, verified_count: 0,  hue: 320 },
  ];

  return (
    <div className="ap">
      <div className="shell">
        <Sidebar persona="coach" active="Roster" />
        <div className="content">
          <Topbar
            search="Search athletes, stats, events"
            actions={<>
              <Btn kind="ghost" size="sm" icon={I.upload}>Bulk import</Btn>
              <Btn kind="primary" size="sm" icon={I.plus}>Invite athlete</Btn>
            </>}
          />
          <div className="main">
            <div className="row between" style={{ marginBottom: 14 }}>
              <div className="col">
                <span className="tiny muted">Bayview United FC &nbsp;›&nbsp; U-17 Girls &nbsp;›&nbsp; Roster</span>
                <h1 style={{ fontSize: 24 }}>Spring 2026 roster <span className="muted" style={{ fontWeight: 400 }}>· 18 athletes</span></h1>
              </div>
              <div className="row gap-2">
                <div className="card" style={{ padding: "10px 14px" }}>
                  <div className="row gap-3">
                    <div className="col"><span className="tiny muted">Pending verifications</span><span className="display strong" style={{ fontSize: 18, color: "#b45309" }}>7</span></div>
                    <div className="vr" />
                    <div className="col"><span className="tiny muted">Roster filled</span><span className="display strong" style={{ fontSize: 18 }}>18 / 22</span></div>
                    <div className="vr" />
                    <div className="col"><span className="tiny muted">Verified avg.</span><span className="display strong" style={{ fontSize: 18, color: "#047857" }}>83%</span></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Filter strip */}
            <div className="row between" style={{ marginBottom: 12 }}>
              <div className="row gap-2">
                {["All athletes (18)", "Invite pending (2)", "Needs profile (1)", "Awaiting verify (7)"].map((c, i) => (
                  <div key={c} style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: i === 0 ? "color-mix(in srgb, var(--color-brand) 12%, white)" : "var(--color-surface-card)",
                    color: i === 0 ? "var(--color-brand)" : "var(--color-text-secondary)",
                    border: "1px solid " + (i === 0 ? "color-mix(in srgb, var(--color-brand) 30%, transparent)" : "var(--color-border)"),
                    cursor: "pointer",
                  }}>{c}</div>
                ))}
              </div>
              <div className="row gap-2">
                <div className="row gap-2" style={{ padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 8, background: "var(--color-surface-card)", color: "var(--color-text-secondary)", fontSize: 12 }}>
                  {I.search}<input placeholder="Filter rows" style={{ border: 0, outline: 0, background: "transparent", font: "inherit", color: "inherit", width: 140 }} />
                </div>
                <Btn kind="ghost" size="sm">Position ▾</Btn>
                <Btn kind="ghost" size="sm">Class year ▾</Btn>
              </div>
            </div>

            <div className="card" style={{ overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--color-surface-hover)" }}>
                    {[
                      ["Athlete", { width: "26%" }],
                      ["#", { width: 56 }],
                      ["Position", { width: "16%" }],
                      ["Class", { width: 60 }],
                      ["GPA", { width: 70 }],
                      ["Status", { width: "11%" }],
                      ["Verified stats", { width: "14%" }],
                      ["", { width: 40 }],
                    ].map(([l, s]) => (
                      <th key={l} style={{ ...s, textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-secondary)" }}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {athletes.map((a, i) => <RosterRow key={i} a={a} even={i % 2 === 0} />)}
                </tbody>
              </table>
              <div className="row between" style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)" }}>
                <span className="tiny muted">Showing 9 of 18 · last updated 2h ago</span>
                <div className="row gap-2">
                  <Btn kind="ghost" size="sm">Export CSV</Btn>
                  <Btn kind="ghost" size="sm">Send announcement</Btn>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- Coach Verify flow ----------
const CoachVerify = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="coach" active="Verify stats" />
      <div className="content">
        <Topbar actions={<><Btn kind="ghost" size="sm">Skip all</Btn><Btn kind="primary" size="sm" icon={<VerifiedTick size={12} />}>Sign all (3)</Btn></>} />
        <div className="main" style={{ position: "relative" }}>
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="col">
              <span className="tiny muted">Verify stats &nbsp;›&nbsp; Sideline submissions</span>
              <h1 style={{ fontSize: 24 }}>Sign verified stats <span className="muted" style={{ fontWeight: 400 }}>· 3 queued</span></h1>
              <p className="muted small" style={{ marginTop: 4, maxWidth: 580 }}>
                Each signature attaches your coach credential to the stat. Athletes' public profiles only display verified records — self-reported stats stay private.
              </p>
            </div>
            <div className="card" style={{ padding: "10px 14px" }}>
              <div className="row gap-3">
                <div className="col"><span className="tiny muted">This season</span><span className="display strong" style={{ fontSize: 18, color: "#047857" }}>142 signed</span></div>
                <div className="vr" />
                <div className="col"><span className="tiny muted">Median time</span><span className="display strong" style={{ fontSize: 18 }}>1.4 days</span></div>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18 }}>
            {/* Left: queue */}
            <div className="col gap-3">
              {[
                {
                  name: "Maya Castellanos", num: "9",
                  match: "vs Oak Valley · 18 May 2026", outcome: "W 3–1",
                  stats: [
                    { k: "Goals", v: "2", was: "1", ok: true },
                    { k: "Assists", v: "1", was: "1", ok: true },
                    { k: "Shots on target", v: "6", was: "6", ok: true },
                    { k: "Pass accuracy", v: "81%", was: "76%", ok: false, note: "Sideline app says 76% — defer to data?" },
                  ],
                  evidence: "From sideline tablet · entered by Asst. Coach Reyes",
                  selected: true,
                },
                {
                  name: "Sara Okafor", num: "10",
                  match: "vs Oak Valley · 18 May 2026", outcome: "W 3–1",
                  stats: [
                    { k: "Assists", v: "2", was: "2", ok: true },
                    { k: "Tackles won", v: "7", was: "7", ok: true },
                    { k: "Distance", v: "10.4 km", was: "10.4 km", ok: true },
                  ],
                  evidence: "From sideline tablet · entered by Asst. Coach Reyes",
                  selected: false,
                },
                {
                  name: "Lily Ahn", num: "11",
                  match: "vs Oak Valley · 18 May 2026", outcome: "W 3–1",
                  stats: [
                    { k: "Goals", v: "1", was: "1", ok: true },
                    { k: "Shots on target", v: "3", was: "3", ok: true },
                  ],
                  evidence: "Self-reported · awaiting coach review",
                  selected: false,
                },
              ].map((c, i) => (
                <div key={i} className="card-soft" style={{
                  padding: 18,
                  borderColor: c.selected ? "color-mix(in srgb, var(--color-brand) 35%, transparent)" : "var(--color-border)",
                  boxShadow: c.selected ? "0 0 0 3px color-mix(in srgb, var(--color-brand) 18%, transparent)" : undefined,
                }}>
                  <div className="row between" style={{ marginBottom: 12 }}>
                    <div className="row gap-3">
                      <Avatar name={c.name} size={40} hue={i === 0 ? 270 : i === 1 ? 300 : 200} />
                      <div className="col">
                        <div className="row gap-2"><span className="strong">{c.name}</span><span className="display tiny" style={{ background: "var(--color-surface-hover)", padding: "1px 6px", borderRadius: 6 }}>#{c.num}</span></div>
                        <span className="tiny muted">{c.match} · <span style={{ color: "#047857", fontWeight: 600 }}>{c.outcome}</span></span>
                      </div>
                    </div>
                    <div className="row gap-2">
                      <Btn kind="ghost" size="sm">Open match</Btn>
                      <Btn kind={c.selected ? "primary" : "ghost"} size="sm" icon={<VerifiedTick size={12} />}>{c.selected ? "Sign all" : "Review"}</Btn>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                    {c.stats.map((s, j) => (
                      <div key={j} className="row between" style={{
                        padding: "10px 12px", borderRadius: 10,
                        background: s.ok ? "color-mix(in srgb, var(--color-action-lime) 8%, white)" : "color-mix(in srgb, var(--color-action-amber) 10%, white)",
                        border: "1px solid " + (s.ok ? "color-mix(in srgb, var(--color-action-lime) 30%, transparent)" : "color-mix(in srgb, var(--color-action-amber) 35%, transparent)"),
                      }}>
                        <div className="col">
                          <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.k}</span>
                          <span className="display strong" style={{ fontSize: 18 }}>{s.v}</span>
                          {s.note && <span className="tiny" style={{ color: "#b45309", marginTop: 2 }}>{s.note}</span>}
                        </div>
                        <div className="col" style={{ alignItems: "flex-end", gap: 6 }}>
                          {s.ok
                            ? <VerifiedTick size={16} />
                            : <span style={{ width: 16, height: 16, borderRadius: 999, background: "#f59e0b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>!</span>
                          }
                          <span className="tiny muted">{s.ok ? "Matches feed" : "Conflict"}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="row between" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--color-border)" }}>
                    <span className="tiny muted row gap-1">{I.shield} {c.evidence}</span>
                    {c.selected ? (
                      <div className="row gap-2">
                        <Btn kind="ghost" size="sm">Edit values</Btn>
                        <Btn kind="coral" size="sm">Reject</Btn>
                        <Btn kind="primary" size="sm" icon={<VerifiedTick size={12} />}>Sign &amp; verify</Btn>
                      </div>
                    ) : <span className="tiny muted">Click Review to inspect</span>}
                  </div>
                </div>
              ))}
            </div>

            {/* Right: signature pane (the actual ceremony) */}
            <div className="col gap-3">
              <div className="card-soft" style={{ padding: 18, position: "sticky", top: 12 }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14 }}>Signature</h3>
                  <Badge tone="brand">Trust chain</Badge>
                </div>
                <div className="row gap-3" style={{ padding: 12, background: "color-mix(in srgb, var(--color-brand) 5%, white)", border: "1px solid color-mix(in srgb, var(--color-brand) 18%, transparent)", borderRadius: 12 }}>
                  <Avatar name="Diego Park" size={42} hue={200} />
                  <div className="col">
                    <span className="strong small">Coach Diego Park</span>
                    <span className="tiny muted">Head coach · Bayview United U-17</span>
                    <span className="tiny mono muted" style={{ marginTop: 4 }}>SafeSport · current · exp 2027</span>
                  </div>
                </div>

                <div className="col gap-2" style={{ margin: "14px 0" }}>
                  <div className="row between small"><span className="muted">Athlete</span><span className="strong">Maya Castellanos · #9</span></div>
                  <div className="row between small"><span className="muted">Match</span><span className="strong">vs Oak Valley · 18 May</span></div>
                  <div className="row between small"><span className="muted">Stats signed</span><span className="strong">3 of 4 · 1 conflict open</span></div>
                  <div className="row between small"><span className="muted">Visibility</span><span className="strong">Public profile (verified)</span></div>
                </div>

                <div className="card" style={{ padding: 14, background: "var(--color-surface-hover)" }}>
                  <span className="tiny muted">Type your name to sign:</span>
                  <input className="input" defaultValue="Diego Park" style={{ marginTop: 6, fontFamily: "var(--font-display)", fontWeight: 600 }} />
                  <label className="row gap-2 tiny" style={{ marginTop: 10 }}>
                    <input type="checkbox" defaultChecked style={{ marginTop: 0 }} />
                    <span>I personally witnessed these stats or reviewed the sideline feed.</span>
                  </label>
                  <label className="row gap-2 tiny" style={{ marginTop: 6 }}>
                    <input type="checkbox" defaultChecked style={{ marginTop: 0 }} />
                    <span>Add to Maya's public profile.</span>
                  </label>
                </div>

                <Btn kind="primary" style={{ marginTop: 12, width: "100%", height: 40 }} icon={<VerifiedTick size={14} />}>Sign &amp; verify 3 stats</Btn>
                <p className="tiny muted" style={{ marginTop: 8, textAlign: "center" }}>
                  Signatures are audit-logged. Reverting requires a new entry.
                </p>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <h4 className="strong small" style={{ marginBottom: 8 }}>How the trust chain works</h4>
                <div className="col gap-2 tiny muted">
                  <div className="row gap-2"><span className="strong" style={{ color: "var(--color-text-primary)" }}>1.</span><span><span className="strong" style={{ color: "var(--color-text-primary)" }}>Bayview FC</span> vouches for the U-17 team.</span></div>
                  <div className="row gap-2"><span className="strong" style={{ color: "var(--color-text-primary)" }}>2.</span><span>The team carries org credibility.</span></div>
                  <div className="row gap-2"><span className="strong" style={{ color: "var(--color-text-primary)" }}>3.</span><span>You sign Maya's stat → stat is verified.</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, { CoachRoster, CoachVerify });
