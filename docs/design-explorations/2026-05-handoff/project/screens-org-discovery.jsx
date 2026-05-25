/* Onboarding gate + Org admin (overview, create team, invite coach) + Discovery.
   Exposes: Onboarding, OrgOverview, OrgCreateTeam, Discovery */

const Onboarding = () => (
  <div className="ap">
    {/* Slim header — no signed-in chrome (this IS the gate before /app) */}
    <div className="row between" style={{ padding: "16px 32px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface-card)" }}>
      <Logo />
      <div className="row gap-3 tiny muted">
        <span>Signed in as <span className="strong" style={{ color: "var(--color-text-primary)" }}>maya.castellanos@bayview.fc</span></span>
        <span>·</span>
        <span>Sign out</span>
      </div>
    </div>

    <div style={{ padding: "40px 32px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 40, maxWidth: 1080, margin: "0 auto" }}>
      <div className="col gap-5">
        <div className="col gap-2">
          <Badge tone="brand" dot>Step 2 of 4</Badge>
          <h1 style={{ fontSize: 32, lineHeight: 1.1 }}>Let's set up your athlete profile.</h1>
          <p className="muted" style={{ maxWidth: 540 }}>
            Coach Diego Park added you to <span className="strong" style={{ color: "var(--color-text-primary)" }}>Bayview United · U-17 Girls</span>. A few details unlock the rest of the portal — you can finish the rest later.
          </p>
        </div>

        {/* Progress strip */}
        <div className="row gap-2">
          {[
            { l: "Account", done: true },
            { l: "Profile basics", active: true },
            { l: "Terms & privacy", done: false },
            { l: "Welcome", done: false },
          ].map((s, i) => (
            <div key={i} className="col" style={{ flex: 1, gap: 6 }}>
              <div style={{
                height: 4, borderRadius: 999,
                background: s.done ? "var(--color-action-lime)" : s.active ? "var(--color-brand)" : "var(--color-surface-active)",
              }} />
              <div className="row gap-2">
                <span style={{ width: 16, height: 16, borderRadius: 999, fontSize: 10, fontWeight: 700,
                  background: s.done ? "var(--color-action-lime)" : s.active ? "var(--color-brand)" : "var(--color-surface-active)",
                  color: s.done || s.active ? "#fff" : "var(--color-text-secondary)",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}>{s.done ? "✓" : i + 1}</span>
                <span className="tiny strong" style={{ color: s.active ? "var(--color-brand)" : "var(--color-text-secondary)" }}>{s.l}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Form */}
        <div className="card-soft" style={{ padding: 28 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>Profile basics</h2>
          <p className="tiny muted" style={{ marginBottom: 18 }}>You can edit any of this later from My profile.</p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="col"><label className="label">Legal first name</label><input className="input" defaultValue="Maya" /></div>
            <div className="col"><label className="label">Legal last name</label><input className="input" defaultValue="Castellanos" /></div>
            <div className="col"><label className="label">Preferred name <span className="muted" style={{ fontWeight: 400 }}>· optional</span></label><input className="input" placeholder="What teammates call you" /></div>
            <div className="col"><label className="label">Date of birth</label><input className="input" defaultValue="March 4, 2009" /></div>
            <div className="col"><label className="label">Primary position</label>
              <div className="select row between" style={{ padding: "0 12px", display: "flex", alignItems: "center" }}><span>Forward (CF)</span>{I.chev}</div>
            </div>
            <div className="col"><label className="label">Preferred foot</label>
              <div className="row gap-2">
                {["Left", "Right", "Both"].map((f, i) => (
                  <label key={f} style={{
                    flex: 1, padding: "8px 12px", border: "1px solid", borderRadius: 10, fontSize: 13, fontWeight: 600, textAlign: "center", cursor: "pointer",
                    background: i === 1 ? "color-mix(in srgb, var(--color-brand) 8%, white)" : "var(--color-surface-card)",
                    borderColor: i === 1 ? "var(--color-brand)" : "var(--color-border)",
                    color: i === 1 ? "var(--color-brand)" : "var(--color-text-primary)",
                  }}>{f}</label>
                ))}
              </div>
            </div>
          </div>

          <hr className="hr" style={{ margin: "20px 0" }} />

          <div className="col gap-2">
            <label className="label">Your team invite <span className="muted" style={{ fontWeight: 400 }}>· from Coach Park</span></label>
            <div className="row gap-3" style={{ padding: 14, border: "1px solid color-mix(in srgb, var(--color-brand) 25%, transparent)", borderRadius: 12, background: "color-mix(in srgb, var(--color-brand) 5%, white)" }}>
              <Avatar name="Bayview United FC" size={48} hue={270} />
              <div className="col" style={{ flex: 1 }}>
                <div className="row gap-2"><span className="strong">Bayview United FC · U-17 Girls</span><Badge tone="lime" dot>Verified org</Badge></div>
                <span className="tiny muted">Spring 2026 · Coach Diego Park · 18-member roster</span>
              </div>
              <div className="row gap-2">
                <Btn kind="ghost" size="sm">Decline</Btn>
                <Btn kind="primary" size="sm" icon={I.check}>Accept</Btn>
              </div>
            </div>
          </div>

          <div className="row between" style={{ marginTop: 22 }}>
            <Btn kind="ghost">← Back</Btn>
            <div className="row gap-2">
              <Btn kind="ghost">Save &amp; continue later</Btn>
              <Btn kind="primary" icon={I.arrow}>Continue · Terms &amp; privacy</Btn>
            </div>
          </div>
        </div>

        <p className="tiny muted">
          By continuing you'll be asked to accept the Athlete ToS v3.2 and Privacy Policy on the next step. You can revoke consent at any time from Settings.
        </p>
      </div>

      {/* Right rail */}
      <div className="col gap-4">
        <div className="card-soft" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Why we ask this</h3>
          <p className="tiny muted">
            Date of birth gates minor-athlete safety features and routes invites through the family center if you're under 13.
            Position and foot help your coach plan the next match — they're editable any time.
          </p>
        </div>
        <div className="card-soft" style={{ padding: 18, background: "color-mix(in srgb, var(--color-action-cyan) 6%, white)", borderColor: "color-mix(in srgb, var(--color-action-cyan) 30%, transparent)" }}>
          <Badge tone="cyan" dot>The wedge</Badge>
          <p className="tiny" style={{ marginTop: 8 }}>
            AthPortal records are <span className="strong">coach-signed</span>. Anything you self-report stays private until your coach verifies it — that's what makes the record portable.
          </p>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h4 className="strong small" style={{ marginBottom: 8 }}>What unlocks next</h4>
          <div className="col gap-2 tiny">
            {["Calendar & RSVPs", "Team feed", "Verified stats history", "Public profile (athportal.io/p/your-name)"].map(t => (
              <span key={t} className="row gap-2"><span className="check" style={{ width: 10, height: 10 }} />{t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Org admin: Overview ----------
const OrgOverview = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="org" active="Overview" />
      <div className="content">
        <Topbar search="Search teams, coaches, athletes" actions={<>
          <Btn kind="ghost" size="sm" icon={I.upload}>Export report</Btn>
          <Btn kind="primary" size="sm" icon={I.plus}>Create team</Btn>
        </>} />
        <div className="main">
          <div className="row between" style={{ marginBottom: 16 }}>
            <div className="col">
              <span className="tiny muted">Bayview United FC</span>
              <h1 style={{ fontSize: 24 }}>Organization overview</h1>
              <p className="muted small" style={{ marginTop: 4 }}>Spring 2026 season · 8 teams · 142 athletes</p>
            </div>
            <div className="row gap-2">
              <Badge tone="lime" dot>Verified org · SafeSport current</Badge>
              <Badge tone="brand">Founding member</Badge>
            </div>
          </div>

          {/* KPI row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 18 }}>
            <Stat label="Active teams" value="8" hint="2 boys · 6 girls" />
            <Stat label="Athletes on roster" value="142" trend="+18 since Aug" />
            <Stat label="Coaches" value="11" hint="all SafeSport current" />
            <Stat label="Verified stats this season" value="1 284" trend="+312 vs last" />
          </div>

          {/* Two cols */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 18 }}>
            {/* Teams table */}
            <div className="card-soft" style={{ padding: 0, overflow: "hidden" }}>
              <div className="row between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)" }}>
                <h3 style={{ fontSize: 14 }}>Teams</h3>
                <Btn kind="ghost" size="sm" icon={I.plus}>New team</Btn>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ background: "var(--color-surface-hover)" }}>
                  {["Team","Coach","Athletes","Season","Verified %"].map(c => <th key={c} style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-secondary)" }}>{c}</th>)}
                </tr></thead>
                <tbody>
                  {[
                    { n: "U-17 Girls", coach: "Diego Park",   athletes: 18, season: "Spring 2026", v: 92, hue: 270 },
                    { n: "U-15 Girls", coach: "Lia Reyes",     athletes: 17, season: "Spring 2026", v: 78, hue: 290 },
                    { n: "U-13 Girls", coach: "Min-Jung Han",  athletes: 16, season: "Spring 2026", v: 64, hue: 320 },
                    { n: "U-17 Boys",  coach: "Cole Anderson", athletes: 19, season: "Spring 2026", v: 88, hue: 220 },
                    { n: "U-15 Boys",  coach: "Will Tate",     athletes: 16, season: "Spring 2026", v: 71, hue: 200 },
                    { n: "U-12 Coed",  coach: "Sam Kelvin",    athletes: 14, season: "Spring 2026", v: 52, hue: 30  },
                  ].map((t, i) => (
                    <tr key={i} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "10px 14px" }}>
                        <div className="row gap-2">
                          <Avatar name={t.n} size={28} hue={t.hue} />
                          <span className="strong small">{t.n}</span>
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px" }} className="small">{t.coach}</td>
                      <td style={{ padding: "10px 14px" }} className="small">{t.athletes}</td>
                      <td style={{ padding: "10px 14px" }} className="small">{t.season}</td>
                      <td style={{ padding: "10px 14px", width: 180 }}>
                        <div className="row gap-2" style={{ alignItems: "center" }}>
                          <div style={{ flex: 1, height: 6, background: "var(--color-surface-active)", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ width: `${t.v}%`, height: "100%", background: t.v > 80 ? "#10b981" : t.v > 65 ? "#06b6d4" : "#f59e0b", borderRadius: 4 }} />
                          </div>
                          <span className="strong small mono" style={{ width: 36, textAlign: "right" }}>{t.v}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Right column */}
            <div className="col gap-4">
              <div className="card-soft" style={{ padding: 18 }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14 }}>Things needing you</h3>
                  <Badge tone="coral" dot>4 open</Badge>
                </div>
                <div className="col gap-2">
                  {[
                    { l: "U-13 Girls has no head coach assigned", t: "coral", a: "Assign coach" },
                    { l: "3 athlete invites pending > 7 days", t: "amber", a: "Resend" },
                    { l: "Coach Tate's SafeSport expires in 14 days", t: "amber", a: "Notify" },
                    { l: "MAAPP one-on-one logged · review", t: "slate", a: "Open" },
                  ].map((r, i) => (
                    <div key={i} className="row gap-3" style={{ padding: "8px 0", borderTop: i ? "1px dashed var(--color-border)" : "none" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 999, marginTop: 8,
                        background: r.t === "coral" ? "#f43f5e" : r.t === "amber" ? "#f59e0b" : "#94a3b8" }} />
                      <span className="small" style={{ flex: 1 }}>{r.l}</span>
                      <Btn kind="ghost" size="sm" style={{ height: 26, padding: "0 8px" }}>{r.a}</Btn>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-soft" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Coaches</h3>
                <div className="col gap-2">
                  {[
                    { n: "Diego Park", t: "U-17 Girls · Head", v: true, hue: 200 },
                    { n: "Lia Reyes", t: "U-15 Girls · Head", v: true, hue: 320 },
                    { n: "Cole Anderson", t: "U-17 Boys · Head", v: true, hue: 220 },
                    { n: "Min-Jung Han", t: "U-13 Girls · Asst.", v: true, hue: 290 },
                    { n: "Will Tate", t: "U-15 Boys · Head", v: false, hue: 30 },
                  ].map((c, i) => (
                    <div key={i} className="row gap-2" style={{ padding: "6px 0", borderTop: i ? "1px dashed var(--color-border)" : "none" }}>
                      <Avatar name={c.n} size={28} hue={c.hue} />
                      <div className="col" style={{ flex: 1, minWidth: 0 }}>
                        <span className="small strong">{c.n}</span>
                        <span className="tiny muted">{c.t}</span>
                      </div>
                      {c.v ? <Badge tone="lime"><VerifiedTick size={11} /> SafeSport</Badge> : <Badge tone="amber" dot>Expiring</Badge>}
                    </div>
                  ))}
                </div>
                <Btn kind="ghost" size="sm" icon={I.plus} style={{ marginTop: 10, width: "100%" }}>Invite a coach</Btn>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Create team + Invite coach (sheet) ----------
const OrgCreateTeam = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="org" active="Teams" />
      <div className="content">
        <Topbar actions={<><Btn kind="ghost" size="sm">Cancel</Btn><Btn kind="primary" size="sm" icon={I.check}>Create team &amp; invite coach</Btn></>} />
        <div className="main">
          <div className="row between" style={{ marginBottom: 14 }}>
            <div className="col">
              <span className="tiny muted">Bayview United FC &nbsp;›&nbsp; Teams &nbsp;›&nbsp; New</span>
              <h1 style={{ fontSize: 24 }}>Create a team</h1>
              <p className="muted small" style={{ marginTop: 4 }}>Set up the team shell — you can add athletes after the coach accepts.</p>
            </div>
            <Ring value={45} size={56} label="Setup" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 22 }}>
            <div className="col gap-4">
              {/* Step 1 */}
              <div className="card-soft" style={{ padding: 22 }}>
                <div className="row gap-2" style={{ marginBottom: 4 }}><Badge tone="brand">Step 1</Badge><span className="strong">Team identity</span></div>
                <p className="tiny muted" style={{ marginBottom: 14 }}>How this team appears on rosters, public pages, and reports.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div className="col"><label className="label">Team name</label><input className="input" defaultValue="U-17 Girls White" /></div>
                  <div className="col"><label className="label">Short label</label><input className="input" defaultValue="U-17 G · W" /></div>
                  <div className="col"><label className="label">Sport</label>
                    <div className="select row between" style={{ padding: "0 12px" }}><span>Soccer</span>{I.chev}</div>
                  </div>
                  <div className="col"><label className="label">Age group</label>
                    <div className="select row between" style={{ padding: "0 12px" }}><span>U-17 (2009 birth year)</span>{I.chev}</div>
                  </div>
                  <div className="col"><label className="label">Gender</label>
                    <div className="row gap-2">
                      {["Girls", "Boys", "Coed"].map((g, i) => (
                        <label key={g} style={{ flex: 1, padding: "8px", border: "1px solid", borderRadius: 10, fontSize: 12, fontWeight: 600, textAlign: "center", cursor: "pointer",
                          background: i === 0 ? "color-mix(in srgb, var(--color-brand) 8%, white)" : "var(--color-surface-card)",
                          borderColor: i === 0 ? "var(--color-brand)" : "var(--color-border)",
                          color: i === 0 ? "var(--color-brand)" : "var(--color-text-primary)" }}>{g}</label>
                      ))}
                    </div>
                  </div>
                  <div className="col"><label className="label">Season</label>
                    <div className="select row between" style={{ padding: "0 12px" }}><span>Fall 2026</span>{I.chev}</div>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="card-soft" style={{ padding: 22 }}>
                <div className="row gap-2" style={{ marginBottom: 4 }}><Badge tone="brand">Step 2</Badge><span className="strong">Invite head coach</span></div>
                <p className="tiny muted" style={{ marginBottom: 14 }}>The head coach owns roster &amp; stat verification. SafeSport status is checked automatically.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div className="col"><label className="label">Coach email</label><input className="input" defaultValue="lia.reyes@bayview.fc" /></div>
                  <div className="col"><label className="label">Display name</label><input className="input" defaultValue="Lia Reyes" /></div>
                </div>
                <div className="row gap-3" style={{ padding: 12, background: "color-mix(in srgb, var(--color-action-lime) 6%, white)", border: "1px solid color-mix(in srgb, var(--color-action-lime) 30%, transparent)", borderRadius: 10, marginTop: 12 }}>
                  <VerifiedTick size={16} />
                  <span className="small">Match found in your coach directory — <span className="strong">Lia Reyes</span>, SafeSport expires 2027-04-02.</span>
                </div>
                <label className="row gap-2 small" style={{ marginTop: 12 }}>
                  <input type="checkbox" defaultChecked /> <span>Send invite email with team welcome packet</span>
                </label>
                <label className="row gap-2 small" style={{ marginTop: 6 }}>
                  <input type="checkbox" /> <span>Also assign as Assistant for U-17 Girls</span>
                </label>
              </div>

              {/* Step 3 */}
              <div className="card-soft" style={{ padding: 22 }}>
                <div className="row gap-2" style={{ marginBottom: 4 }}><Badge tone="slate">Step 3</Badge><span className="strong">Athletes (optional)</span></div>
                <p className="tiny muted" style={{ marginBottom: 12 }}>Bulk-invite now, or let the coach do it after accepting.</p>
                <div className="row gap-2">
                  <Btn kind="ghost" size="sm" icon={I.upload}>Upload CSV</Btn>
                  <Btn kind="ghost" size="sm" icon={I.plus}>Pick from directory</Btn>
                  <div style={{ flex: 1 }} />
                  <span className="tiny muted">0 added · max 30 per import</span>
                </div>
              </div>
            </div>

            {/* Right: preview */}
            <div className="col gap-3">
              <div className="card-soft" style={{ padding: 18 }}>
                <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Preview</span>
                <div className="row gap-3" style={{ marginTop: 10, padding: 14, border: "1px solid var(--color-border)", borderRadius: 12 }}>
                  <Avatar name="U-17 Girls White" size={48} hue={290} />
                  <div className="col" style={{ minWidth: 0, flex: 1 }}>
                    <div className="row gap-2"><span className="strong">U-17 Girls White</span><Badge tone="lime" dot>Org-vouched</Badge></div>
                    <span className="tiny muted">Bayview United FC · Fall 2026 · Coach Lia Reyes</span>
                  </div>
                </div>
                <div className="col gap-2 tiny muted" style={{ marginTop: 12 }}>
                  <div className="row between"><span>Public slug</span><span className="mono strong" style={{ color: "var(--color-text-primary)" }}>/t/bayview-u17-girls-white</span></div>
                  <div className="row between"><span>Indexing</span><Badge tone="slate">allow</Badge></div>
                  <div className="row between"><span>Roster cap</span><span className="strong" style={{ color: "var(--color-text-primary)" }}>30 athletes</span></div>
                </div>
              </div>
              <div className="card" style={{ padding: 14, background: "var(--color-surface-hover)" }}>
                <h4 className="strong tiny" style={{ marginBottom: 6 }}>Separation of duty</h4>
                <p className="tiny muted">As org admin you can't verify athletes' stats — that's the coach's role. This is what keeps the trust chain meaningful.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Discovery ----------
const Discovery = () => (
  <div className="ap">
    <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-surface-card)", borderBottom: "1px solid var(--color-border)" }}>
      <div className="row between" style={{ padding: "14px 32px" }}>
        <div className="row gap-5">
          <Logo />
          <div className="row gap-3 tiny muted">
            <span className="strong" style={{ color: "var(--color-brand)" }}>Athletes</span>
            <span>Clubs</span>
            <span>Teams</span>
            <span>Tournaments</span>
          </div>
        </div>
        <div className="row gap-2">
          <Btn kind="ghost" size="sm">Sign in</Btn>
          <Btn kind="primary" size="sm">Get started</Btn>
        </div>
      </div>
    </div>

    <div style={{ padding: "20px 32px", overflow: "auto", height: "calc(100% - 53px)" }}>
      <div className="col gap-2" style={{ marginBottom: 18 }}>
        <span className="tiny muted">Discovery</span>
        <h1 style={{ fontSize: 26 }}>Athletes <span className="muted" style={{ fontWeight: 400 }}>· public profiles</span></h1>
      </div>

      {/* Filter strip */}
      <div className="card-soft" style={{ padding: 14, marginBottom: 16 }}>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <div className="row gap-2" style={{ padding: "6px 10px", border: "1px solid var(--color-border)", borderRadius: 8, color: "var(--color-text-secondary)", fontSize: 12, flex: 1, minWidth: 280 }}>
            {I.search}<input placeholder="Search athletes, clubs, or positions" style={{ border: 0, outline: 0, background: "transparent", font: "inherit", color: "inherit", flex: 1 }} />
          </div>
          {["Soccer", "Girls", "U-17", "Forward", "Class of 2027", "NorCal"].map((c, i) => (
            <span key={c} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
              background: i < 2 ? "color-mix(in srgb, var(--color-brand) 10%, white)" : "var(--color-surface-card)",
              color: i < 2 ? "var(--color-brand)" : "var(--color-text-secondary)",
              border: "1px solid " + (i < 2 ? "color-mix(in srgb, var(--color-brand) 28%, transparent)" : "var(--color-border)"),
            }}>{c}</span>
          ))}
          <Btn kind="ghost" size="sm">+ More filters</Btn>
          <div style={{ flex: 1 }} />
          <div className="row" style={{ background: "var(--color-surface-card)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
            {["Grid", "List", "Map"].map((v, i) => (
              <div key={v} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                background: i === 0 ? "color-mix(in srgb, var(--color-brand) 12%, transparent)" : "transparent",
                color: i === 0 ? "var(--color-brand)" : "var(--color-text-secondary)",
                borderRight: i < 2 ? "1px solid var(--color-border)" : "none" }}>{v}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="tiny muted">Showing <span className="strong" style={{ color: "var(--color-text-primary)" }}>284 athletes</span> · sorted by Recent activity</span>
        <Btn kind="ghost" size="sm">Sort ▾</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {[
          { n: "Maya Castellanos", t: "Forward · #9", c: "Bayview United · U-17", g: 14, a: 9, v: true, hue: 270, year: 2027 },
          { n: "Jordan Reyes", t: "Midfielder · #6", c: "Sutter Spurs · U-17", g: 4, a: 11, v: true, hue: 30, year: 2027 },
          { n: "Camila Vega", t: "Forward · #11", c: "Riverside Strikers · U-17", g: 17, a: 6, v: true, hue: 320, year: 2026 },
          { n: "Sara Okafor", t: "Midfielder · #10", c: "Bayview United · U-17", g: 6, a: 12, v: true, hue: 300, year: 2026 },
          { n: "Lily Ahn", t: "Winger · #11", c: "Bayview United · U-17", g: 9, a: 8, v: true, hue: 200, year: 2027 },
          { n: "Hannah Kim", t: "Defender · #4", c: "Oak Valley · U-17", g: 1, a: 3, v: false, hue: 140, year: 2028 },
        ].map((p, i) => (
          <div key={i} className="card-soft" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ph" style={{ aspectRatio: "3 / 1", borderRadius: 0, border: "none", position: "relative" }}>
              <span>{`<cover>`}</span>
              <div style={{ position: "absolute", inset: "auto 0 0 0", background: "linear-gradient(180deg, rgba(15,17,21,0), rgba(15,17,21,0.45))", height: "60%" }} />
            </div>
            <div style={{ padding: 14, marginTop: -32, position: "relative" }}>
              <div className="row between">
                <Avatar name={p.n} size={56} hue={p.hue} />
                {p.v && <Badge tone="lime" style={{ marginTop: 36 }}><VerifiedTick size={11} /> Verified</Badge>}
              </div>
              <div className="col" style={{ marginTop: 10, gap: 2 }}>
                <span className="strong">{p.n}</span>
                <span className="tiny muted">{p.t} · Class of {p.year}</span>
                <span className="tiny muted">{p.c}</span>
              </div>
              <div className="row gap-3" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
                <div className="col"><span className="tiny muted">Goals</span><span className="display strong">{p.g}</span></div>
                <div className="col"><span className="tiny muted">Assists</span><span className="display strong">{p.a}</span></div>
                <div className="col" style={{ flex: 1 }}><span className="tiny muted">Form</span><MiniSpark w={80} h={24} points={[2,3,2,4,3,5,4,6,5]} /></div>
                <Btn kind="ghost" size="sm" style={{ height: 28 }}>View</Btn>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

Object.assign(window, { Onboarding, OrgOverview, OrgCreateTeam, Discovery });
