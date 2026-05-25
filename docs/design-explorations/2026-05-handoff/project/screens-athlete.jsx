/* Athlete-persona screens: Home dashboard, Private profile edit, Public profile.
   Exposes: AthleteHome, AthleteProfileEdit, PublicProfile */

const AthleteHome = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="athlete" active="Home" />
      <div className="content">
        <Topbar
          actions={<>
            <Btn kind="ghost" size="sm" icon={I.share}>Share profile</Btn>
            <Btn kind="primary" size="sm" icon={I.upload}>Upload</Btn>
          </>}
        />
        <div className="main">
          {/* Hero card */}
          <div className="card-soft" style={{ padding: 24, marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}>
            <div className="col gap-3">
              <div className="row gap-2"><Badge tone="brand" dot>Good morning</Badge><span className="tiny muted">Wednesday, 21 May 2026</span></div>
              <h1 style={{ fontSize: 30, lineHeight: 1.1 }}>Welcome back, Maya.</h1>
              <p className="muted" style={{ maxWidth: 560, fontSize: 14 }}>
                You have one match this week and two unverified stats waiting on Coach Park. Your profile is 84% complete —
                add a highlight reel to reach the &ldquo;Recruiter-ready&rdquo; threshold.
              </p>
              <div className="row gap-2">
                <Btn kind="primary" size="sm" icon={I.bolt}>Finish profile</Btn>
                <Btn kind="ghost" size="sm" icon={I.calendar}>This week</Btn>
              </div>
            </div>
            <div className="card" style={{ padding: 16, display: "flex", gap: 16, alignItems: "center", background: "color-mix(in srgb, var(--color-brand) 6%, white)" }}>
              <Ring value={84} size={84} />
              <div className="col gap-1" style={{ minWidth: 0 }}>
                <span className="display strong" style={{ fontSize: 14 }}>Profile completion</span>
                <span className="tiny muted">3 of 18 fields remaining</span>
                <div className="col gap-1" style={{ marginTop: 6 }}>
                  <span className="tiny" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span className="check" style={{ width: 10, height: 10 }} />Academic info</span>
                  <span className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85 }}><span style={{ width: 10, height: 10, borderRadius: 999, border: "1.5px solid #cbd5e1" }} />Highlight reel</span>
                  <span className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.85 }}><span style={{ width: 10, height: 10, borderRadius: 999, border: "1.5px solid #cbd5e1" }} />Cover photo</span>
                </div>
              </div>
            </div>
          </div>

          {/* Stat row */}
          <div className="row between" style={{ marginBottom: 10 }}>
            <h2 style={{ fontSize: 17 }}>Season at a glance <span className="muted small" style={{ fontWeight: 400, marginLeft: 6 }}>Bayview United · U-17 Girls · Spring 2026</span></h2>
            <div className="row gap-2 small muted"><Badge tone="lime" dot>Verified by Coach Park</Badge></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
            <Stat label="Goals" value="14" trend="+3 vs last 5" verified />
            <Stat label="Assists" value="9" trend="+2 vs last 5" verified />
            <Stat label="Shots on target" value="62%" hint="44 of 71" verified />
            <Stat label="Minutes" value="1 184" unit="min" hint="14 starts" />
          </div>

          {/* Two-col main */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
            {/* Left: upcoming + activity */}
            <div className="col gap-4">
              <div className="card-soft" style={{ padding: 18 }}>
                <div className="row between" style={{ marginBottom: 12 }}>
                  <h3 style={{ fontSize: 15 }}>This week</h3>
                  <Btn kind="ghost" size="sm" icon={I.arrow} style={{ height: 28 }}>Full calendar</Btn>
                </div>
                <div className="col gap-2">
                  {[
                    { day: "Thu", date: "22", type: "practice", title: "Tactical session · final third", time: "5:30 PM", venue: "Bayview Sports Park · Pitch 3", rsvp: "going" },
                    { day: "Sat", date: "24", type: "game", title: "vs Riverside Strikers (H)", time: "11:00 AM", venue: "Bayview Stadium", rsvp: "going" },
                    { day: "Mon", date: "26", type: "academic", title: "Player–coach review", time: "4:00 PM", venue: "Online · Zoom", rsvp: "pending" },
                  ].map((e, i) => (
                    <div key={i} className="row gap-3" style={{ padding: "10px 4px", borderTop: i ? "1px solid var(--color-border)" : "none" }}>
                      <div className="col" style={{ width: 44, textAlign: "center" }}>
                        <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>{e.day}</span>
                        <span className="display" style={{ fontSize: 22, fontWeight: 700 }}>{e.date}</span>
                      </div>
                      <div className="col" style={{ flex: 1, minWidth: 0 }}>
                        <div className="row gap-2"><Badge tone={e.type === "game" ? "coral" : e.type === "practice" ? "cyan" : "amber"}>{e.type}</Badge><span className="tiny muted">{e.time}</span></div>
                        <span className="strong" style={{ fontSize: 13.5, marginTop: 2 }}>{e.title}</span>
                        <span className="tiny muted">{e.venue}</span>
                      </div>
                      {e.rsvp === "going" ? <Badge tone="lime">RSVP'd · going</Badge> : <Btn kind="ghost" size="sm">RSVP</Btn>}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-soft" style={{ padding: 18 }}>
                <div className="row between" style={{ marginBottom: 12 }}>
                  <h3 style={{ fontSize: 15 }}>Recent activity</h3>
                  <Btn kind="ghost" size="sm">View all</Btn>
                </div>
                <div className="col">
                  {[
                    { who: "Coach Park", what: "verified your stat", target: "2 goals · vs Oak Valley", when: "2h ago", tone: "lime", icon: <VerifiedTick /> },
                    { who: "Lily Ahn", what: "tagged you in a post", target: "&ldquo;Pre-match brief 🎯&rdquo;", when: "5h ago", tone: "brand", icon: I.feed },
                    { who: "Org admin", what: "added you to a new roster", target: "Lincoln HS · Varsity", when: "Yesterday", tone: "cyan", icon: I.team },
                    { who: "Coach Park", what: "left a comment on your clip", target: "&ldquo;Pen-box positioning, frame 0:48&rdquo;", when: "2d ago", tone: "slate", icon: I.comment },
                  ].map((a, i) => (
                    <div key={i} className="row gap-3" style={{ padding: "10px 0", borderTop: i ? "1px solid var(--color-border)" : "none" }}>
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--color-surface-hover)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-text-secondary)", flex: "0 0 auto" }}>{a.icon}</div>
                      <div className="col" style={{ flex: 1 }}>
                        <span className="small"><span className="strong">{a.who}</span> {a.what} <span className="muted" dangerouslySetInnerHTML={{ __html: a.target }} /></span>
                        <span className="tiny muted">{a.when}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: pinned achievement + teams + feed */}
            <div className="col gap-4">
              <div className="card-soft" style={{ padding: 18 }}>
                <div className="row between" style={{ marginBottom: 12 }}>
                  <h3 style={{ fontSize: 15 }}>Pinned achievement</h3>
                  <Badge tone="lime" dot>Verified</Badge>
                </div>
                <div className="row gap-3" style={{ padding: 12, background: "color-mix(in srgb, var(--color-brand) 6%, white)", borderRadius: 12, border: "1px solid color-mix(in srgb, var(--color-brand) 18%, transparent)" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--color-brand)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>{I.trophy}</div>
                  <div className="col" style={{ flex: 1 }}>
                    <span className="display strong" style={{ fontSize: 14 }}>NorCal U-17 Player of the Month</span>
                    <span className="tiny muted">April 2026 · Signed by Coach Park</span>
                  </div>
                </div>
                <div className="row gap-2 tiny muted" style={{ marginTop: 10 }}>
                  <Badge tone="cyan">14 verified stats</Badge>
                  <Badge tone="brand">5 milestones</Badge>
                </div>
              </div>

              <div className="card-soft" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 15, marginBottom: 12 }}>My teams</h3>
                <div className="col gap-2">
                  {[
                    { name: "Bayview United FC · U-17", role: "Forward · #9", season: "Spring 2026", hue: 270 },
                    { name: "Lincoln HS · Varsity Girls", role: "Forward · #11", season: "Fall 2026", hue: 200 },
                  ].map((t, i) => (
                    <div key={i} className="row gap-3" style={{ padding: 10, border: "1px solid var(--color-border)", borderRadius: 10 }}>
                      <Avatar name={t.name} size={36} hue={t.hue} />
                      <div className="col" style={{ flex: 1 }}>
                        <span className="strong small">{t.name}</span>
                        <span className="tiny muted">{t.role} · {t.season}</span>
                      </div>
                      {I.chev}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-soft" style={{ padding: 18 }}>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 15 }}>Recruiter activity</h3>
                  <Badge tone="slate">Public · last 30d</Badge>
                </div>
                <div className="row" style={{ alignItems: "flex-end", gap: 6, marginBottom: 8 }}>
                  <span className="display" style={{ fontSize: 28, fontWeight: 700 }}>238</span>
                  <span className="small muted">profile views</span>
                  <span className="small" style={{ color: "#047857", fontWeight: 600, marginLeft: "auto" }}>↑ 42%</span>
                </div>
                <MiniSpark w={260} h={42} points={[2,4,3,6,5,8,7,9,8,11,10,14,13,18]} />
                <div className="tiny muted" style={{ marginTop: 6 }}>Sources: shared link (61%), Bayview United directory (27%), search (12%)</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Private profile edit ----------
const AthleteProfileEdit = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="athlete" active="My profile" />
      <div className="content">
        <Topbar actions={<><Btn kind="ghost" size="sm">Preview public</Btn><Btn kind="primary" size="sm">Save changes</Btn></>} />
        <div className="main">
          <div className="row between" style={{ marginBottom: 16 }}>
            <div className="col">
              <span className="tiny muted">Settings &nbsp;›&nbsp; My profile</span>
              <h1 style={{ fontSize: 24 }}>Profile</h1>
            </div>
            <div className="row gap-3">
              <div className="card" style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <Ring value={84} size={36} />
                <div className="col">
                  <span className="tiny muted">Completion</span>
                  <span className="strong small">15 of 18 fields</span>
                </div>
              </div>
              <div className="card" style={{ padding: "8px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: 999, background: "#10b981" }} />
                <div className="col">
                  <span className="tiny muted">Public URL</span>
                  <span className="strong small mono">athportal.io/p/maya-c</span>
                </div>
                <button className="btn ghost sm" style={{ height: 26, padding: "0 8px" }}>{I.link}</button>
              </div>
            </div>
          </div>

          {/* Tab strip */}
          <div className="row gap-1" style={{ borderBottom: "1px solid var(--color-border)", marginBottom: 18 }}>
            {["Identity", "Athletic", "Academic", "Branding", "Privacy", "Linked accounts"].map((t, i) => (
              <div key={t} style={{
                padding: "10px 14px", fontSize: 13, fontWeight: i === 1 ? 600 : 500,
                color: i === 1 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                borderBottom: i === 1 ? "2px solid var(--color-brand)" : "2px solid transparent",
                marginBottom: -1, cursor: "pointer",
              }}>{t}</div>
            ))}
          </div>

          {/* Two columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>
            {/* Left: forms */}
            <div className="col gap-5">
              {/* Section: Profile media */}
              <section>
                <div className="row between" style={{ marginBottom: 10 }}>
                  <h3 style={{ fontSize: 14 }}>Cover & avatar</h3>
                  <span className="tiny muted">JPEG, PNG, or WebP · Cover ≥ 1200×400 · Avatar ≥ 256×256</span>
                </div>
                <div className="card" style={{ padding: 0, overflow: "hidden", position: "relative" }}>
                  <div style={{ aspectRatio: "3 / 1", position: "relative" }}>
                    <div className="ph" style={{ position: "absolute", inset: 0, borderRadius: 0, border: "none" }}><span>{`<cover photo · 1200×400+>`}</span></div>
                    <button className="btn ghost sm" style={{ position: "absolute", right: 12, top: 12, background: "rgba(255,255,255,0.92)" }}>{I.upload}Replace cover</button>
                  </div>
                  <div className="row gap-3" style={{ padding: "14px 16px", borderTop: "1px solid var(--color-border)" }}>
                    <Avatar name="Maya Castellanos" size={56} hue={270} />
                    <div className="col" style={{ flex: 1 }}>
                      <span className="strong small">Profile photo</span>
                      <span className="tiny muted">Used on rosters, public profile, and the team feed.</span>
                    </div>
                    <Btn kind="ghost" size="sm" icon={I.upload}>Upload</Btn>
                  </div>
                </div>
              </section>

              {/* Athletic attributes */}
              <section>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Athletic attributes</h3>
                <div className="card" style={{ padding: 18 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
                    {[
                      ["Primary position", "Forward (CF)"],
                      ["Secondary position", "Winger (RW)"],
                      ["Preferred foot", "Right"],
                      ["Height", "5′ 7″ / 170 cm"],
                      ["Weight", "128 lb / 58 kg"],
                      ["Date of birth", "March 4, 2009"],
                    ].map(([l, v], i) => (
                      <div key={i} className="col">
                        <label className="label">{l}</label>
                        <input className="input" defaultValue={v} />
                      </div>
                    ))}
                  </div>
                  <hr className="hr" style={{ margin: "18px 0" }} />
                  <div className="col gap-2">
                    <label className="label row between"><span>Jersey numbers <span className="muted" style={{ fontWeight: 400 }}>· per team</span></span>
                      <span className="tiny muted">Click to edit</span>
                    </label>
                    <div className="row gap-2">
                      {[
                        { team: "Bayview United · U-17", num: "9" },
                        { team: "Lincoln HS · Varsity", num: "11" },
                      ].map((j, i) => (
                        <div key={i} className="row gap-2" style={{ padding: "8px 12px", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                          <Avatar name={j.team} size={26} hue={i === 0 ? 270 : 200} />
                          <span className="small">{j.team}</span>
                          <span className="strong display" style={{ background: "var(--color-surface-hover)", padding: "2px 8px", borderRadius: 6 }}>#{j.num}</span>
                        </div>
                      ))}
                      <button className="btn ghost sm" style={{ height: 38 }}>{I.plus}Add</button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Highlight reel + media */}
              <section>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Media & highlight reel</h3>
                <div className="card" style={{ padding: 16 }}>
                  <div className="row between" style={{ marginBottom: 12 }}>
                    <div className="col">
                      <span className="strong small">Featured reel</span>
                      <span className="tiny muted">Pinned to the top of your public profile.</span>
                    </div>
                    <Btn kind="ghost" size="sm" icon={I.upload}>Upload clip</Btn>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                    {[
                      { t: "vs Oak Valley · 18 May", dur: "2:14", pinned: true },
                      { t: "Group stage hat-trick", dur: "1:38" },
                      { t: "Free-kick training", dur: "0:42", processing: true },
                    ].map((c, i) => (
                      <div key={i} className="ph" style={{ aspectRatio: "16 / 9", borderRadius: 10, position: "relative", padding: 8, alignItems: "flex-end", justifyContent: "flex-start" }}>
                        {c.pinned && <span style={{ position: "absolute", top: 6, left: 6 }}><Badge tone="brand">Pinned</Badge></span>}
                        {c.processing && <span style={{ position: "absolute", top: 6, left: 6 }}><Badge tone="amber" dot>Processing</Badge></span>}
                        <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 10, padding: "1px 5px", background: "rgba(15,17,21,0.7)", color: "#fff", borderRadius: 4 }}>{c.dur}</span>
                        <span className="tiny" style={{ background: "rgba(255,255,255,0.94)", padding: "2px 6px", borderRadius: 4, color: "var(--color-text-primary)" }}>{c.t}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            {/* Right: tips + completion */}
            <div className="col gap-4">
              <div className="card-soft" style={{ padding: 16 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Finish your profile</h3>
                <div className="col gap-2">
                  {[
                    { l: "Add a cover photo", done: false, hint: "Recruiters scan this first." },
                    { l: "Upload a highlight reel", done: false, hint: "Unlocks the Recruiter-ready badge." },
                    { l: "Connect academic info", done: false, hint: "GPA, transcript, graduation year." },
                    { l: "Verified stats from Coach Park", done: true, hint: "14 verified · last on 18 May" },
                    { l: "Set a vanity URL", done: true, hint: "athportal.io/p/maya-c" },
                  ].map((t, i) => (
                    <div key={i} className="row gap-2" style={{ padding: "8px 0", borderTop: i ? "1px dashed var(--color-border)" : "none" }}>
                      <span style={{ width: 18, height: 18, borderRadius: 999,
                        background: t.done ? "#10b981" : "transparent",
                        border: t.done ? "none" : "1.5px dashed #cbd5e1",
                        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", marginTop: 1 }}>
                        {t.done ? <Icon d={<path d="M5 12l4 4 10-10" />} size={12} sw={2.5} stroke="#fff" /> : null}
                      </span>
                      <div className="col" style={{ flex: 1 }}>
                        <span className="small strong" style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--color-text-secondary)" : "var(--color-text-primary)" }}>{t.l}</span>
                        <span className="tiny muted">{t.hint}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-soft" style={{ padding: 16, background: "color-mix(in srgb, var(--color-action-cyan) 6%, white)", borderColor: "color-mix(in srgb, var(--color-action-cyan) 25%, transparent)" }}>
                <div className="row gap-2" style={{ marginBottom: 8 }}>
                  <Badge tone="cyan" dot>Trust chain</Badge>
                </div>
                <p className="small" style={{ color: "var(--color-text-primary)" }}>
                  Stats you enter yourself never show as verified. Ask Coach Park to sign them — the green tick is what makes your record portable.
                </p>
              </div>

              <div className="card" style={{ padding: 16 }}>
                <h4 className="strong small" style={{ marginBottom: 8 }}>Vanity URL</h4>
                <div className="row gap-2" style={{ marginBottom: 8 }}>
                  <span className="tiny muted mono" style={{ padding: "8px 0" }}>athportal.io/p/</span>
                  <input className="input" defaultValue="maya-c" style={{ flex: 1 }} />
                </div>
                <span className="tiny muted">a–z, 0–9, hyphens. 3–40 chars. Available ✓</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Public profile (shareable) ----------
const PublicProfile = () => (
  <div className="ap">
    {/* Slim public header (no signed-in chrome) */}
    <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--color-surface-card)", borderBottom: "1px solid var(--color-border)" }}>
      <div className="row between" style={{ padding: "14px 32px" }}>
        <div className="row gap-4">
          <Logo />
          <span className="tiny muted">Public athlete profile · <span className="mono">athportal.io/p/maya-c</span></span>
        </div>
        <div className="row gap-2">
          <Btn kind="ghost" size="sm" icon={I.share}>Share</Btn>
          <Btn kind="ghost" size="sm" icon={I.heart}>Save athlete</Btn>
          <Btn kind="primary" size="sm">Sign in</Btn>
        </div>
      </div>
    </div>

    <div style={{ overflow: "auto", height: "calc(100% - 53px)" }}>
      {/* Cover */}
      <div style={{ aspectRatio: "3 / 1", position: "relative" }}>
        <div className="ph" style={{ position: "absolute", inset: 0, border: "none", borderRadius: 0 }}><span>{`<cover photo · 1200×400+>`}</span></div>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(15,17,21,0) 40%, rgba(15,17,21,0.55) 100%)" }} />
      </div>

      {/* Identity card */}
      <div style={{ padding: "0 32px", marginTop: -56, position: "relative", zIndex: 2 }}>
        <div className="card-soft" style={{ padding: 22, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 22, alignItems: "center", borderTop: "3px solid var(--color-brand)" }}>
          <Avatar name="Maya Castellanos" size={96} hue={270} />
          <div className="col gap-2" style={{ minWidth: 0 }}>
            <div className="row gap-2">
              <Badge tone="brand">Athlete profile</Badge>
              <Badge tone="lime"><VerifiedTick size={11} /> Verified by 2 coaches</Badge>
            </div>
            <h1 style={{ fontSize: 30, lineHeight: 1.05 }}>Maya Castellanos</h1>
            <div className="row gap-2 small muted">
              <span><span className="strong" style={{ color: "var(--color-text-primary)" }}>Forward</span> · #9 · Right foot</span>
              <span>·</span><span>5′ 7″</span><span>·</span><span>Class of 2027</span>
            </div>
            <div className="row gap-3 tiny muted" style={{ marginTop: 2 }}>
              <span className="row gap-1">{I.pin} San Mateo, CA</span>
              <span className="row gap-1">{I.team} Bayview United FC · Lincoln HS</span>
              <span className="row gap-1">{I.globe} maya-c.io</span>
            </div>
          </div>
          <div className="col gap-2" style={{ alignItems: "flex-end" }}>
            <Btn kind="primary" icon={I.heart}>Save athlete</Btn>
            <Btn kind="ghost" size="sm" icon={I.share}>Share profile</Btn>
            <span className="tiny muted">238 views · last 30 days</span>
          </div>
        </div>
      </div>

      {/* Main body */}
      <div style={{ padding: "20px 32px 32px", display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 }}>
        <div className="col gap-4">
          {/* Featured reel */}
          <div className="card-soft" style={{ padding: 16 }}>
            <div className="row between" style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14 }}>Featured reel</h3>
              <span className="tiny muted">Pinned by Maya · 2:14</span>
            </div>
            <div className="ph" style={{ aspectRatio: "16 / 9", borderRadius: 12, position: "relative" }}>
              <span>{`<Mux video player · highlight reel>`}</span>
              <div style={{ position: "absolute", left: 16, bottom: 14, color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
                <div className="row gap-2"><Badge tone="brand">Featured</Badge></div>
                <div className="display strong" style={{ fontSize: 16, marginTop: 6 }}>Season highlights · Spring 2026</div>
              </div>
              <div style={{ position: "absolute", right: 14, top: 14, width: 48, height: 48, borderRadius: 999, background: "rgba(255,255,255,0.92)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-brand)" }}>
                <Icon d={<path d="M8 5v14l11-7L8 5Z" />} size={22} fill="currentColor" stroke="none" />
              </div>
            </div>
          </div>

          {/* Verified stats */}
          <div className="card-soft" style={{ padding: 18 }}>
            <div className="row between" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 14 }}>Verified statistics <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 6 }}>Spring 2026 · Bayview United U-17</span></h3>
              <div className="row gap-2"><Badge tone="lime"><VerifiedTick size={11} /> Coach-signed</Badge></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <Stat label="Goals" value="14" verified />
              <Stat label="Assists" value="9" verified />
              <Stat label="Shots" value="71" verified />
              <Stat label="On target" value="62%" verified />
              <Stat label="Pass acc." value="78%" verified />
              <Stat label="Tackles" value="44" verified />
              <Stat label="Minutes" value="1 184" verified />
              <Stat label="Starts" value="14 / 16" verified />
            </div>
            <div className="row between" style={{ marginTop: 14 }}>
              <div className="row gap-2 tiny muted"><span className="row gap-1">{I.shield} Signed by <span className="strong" style={{ color: "var(--color-text-primary)" }}>Coach Diego Park</span></span><span>·</span><span>Updated 2h ago</span></div>
              <Btn kind="ghost" size="sm">Full stat sheet →</Btn>
            </div>
          </div>

          {/* Heatmap + Strengths */}
          <div className="card-soft" style={{ padding: 18 }}>
            <div className="row between" style={{ marginBottom: 14 }}>
              <h3 style={{ fontSize: 14 }}>Where she plays</h3>
              <Badge tone="brand">Forward · right-side bias</Badge>
            </div>
            <div className="row gap-4">
              <FieldHeatmap w={300} h={180} />
              <div className="col gap-3" style={{ flex: 1 }}>
                <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>Strengths</span>
                <MiniBars values={[0.78, 0.62, 0.71, 0.84]} labels={["Pass accuracy", "Shot conversion", "Duels won", "Sprint count vs peers"]} />
              </div>
            </div>
          </div>

          {/* Career timeline */}
          <div className="card-soft" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>Career timeline</h3>
            <div className="col">
              {[
                { yr: "2026", t: "NorCal U-17 Player of the Month — April", v: true },
                { yr: "2025", t: "Bayview United · captain, U-16 cup champions", v: true },
                { yr: "2024", t: "ECNL Regional XI selection", v: true },
                { yr: "2023", t: "Lincoln HS varsity debut · class of 2027", v: false },
              ].map((e, i) => (
                <div key={i} className="row gap-3" style={{ padding: "10px 0", borderTop: i ? "1px solid var(--color-border)" : "none" }}>
                  <span className="display strong mono" style={{ width: 48, color: "var(--color-text-secondary)" }}>{e.yr}</span>
                  <span className="small" style={{ flex: 1 }}>{e.t}</span>
                  {e.v ? <Badge tone="lime"><VerifiedTick size={11} /> Verified</Badge> : <Badge tone="slate">Self-reported</Badge>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="col gap-4">
          <div className="card-soft" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>About</h3>
            <p className="small muted">
              Forward with a right-foot finish and a habit of finding space in the half-spaces. Plays for Bayview United FC (U-17)
              and Lincoln HS Varsity. Targeting D1 programs with an academic emphasis on biology.
            </p>
            <hr className="hr" style={{ margin: "14px 0" }} />
            <div className="col gap-2 small">
              {[
                ["Class of", "2027"],
                ["GPA", "3.92 (unweighted)"],
                ["Test scores", "SAT 1480 · self-reported"],
                ["Languages", "English, Spanish"],
                ["Club tenure", "Since 2022"],
              ].map(([k, v]) => (
                <div key={k} className="row between">
                  <span className="muted">{k}</span>
                  <span className="strong">{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-soft" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>Teams</h3>
            <div className="col gap-2">
              {[
                { t: "Bayview United FC · U-17 Girls", role: "Forward · #9", v: true, hue: 270 },
                { t: "Lincoln HS · Varsity Girls", role: "Forward · #11", v: true, hue: 200 },
              ].map((t, i) => (
                <div key={i} className="row gap-3" style={{ padding: 10, border: "1px solid var(--color-border)", borderRadius: 10 }}>
                  <Avatar name={t.t} size={36} hue={t.hue} />
                  <div className="col" style={{ flex: 1 }}>
                    <div className="row gap-2"><span className="strong small">{t.t}</span>{t.v && <VerifiedTick size={12} />}</div>
                    <span className="tiny muted">{t.role}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card-soft" style={{ padding: 18 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Trust chain</h3>
            <div className="col gap-2 small">
              {[
                { who: "Bayview United FC", role: "Organization", v: true, k: "Vouches for the U-17 team" },
                { who: "Coach Diego Park", role: "Coach · U-17 Girls", v: true, k: "Signs verified stats" },
                { who: "Maya Castellanos", role: "Athlete", v: true, k: "Owns this profile" },
              ].map((c, i) => (
                <div key={i} className="row gap-3" style={{ padding: "8px 0", borderTop: i ? "1px dashed var(--color-border)" : "none" }}>
                  <div style={{ width: 6, height: 6, borderRadius: 999, background: "#10b981", marginTop: 8 }} />
                  <div className="col" style={{ flex: 1 }}>
                    <div className="row gap-2"><span className="strong">{c.who}</span>{c.v && <VerifiedTick size={11} />}</div>
                    <span className="tiny muted">{c.role} · {c.k}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="tiny muted" style={{ marginTop: 10 }}>What this means →</p>
          </div>
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, { AthleteHome, AthleteProfileEdit, PublicProfile });
