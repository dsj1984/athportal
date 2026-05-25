/* Foundations swatch card + Expressive variation row.
   Exposes: Foundations, ExpressivePublicProfile, ExpressiveAthleteHome, ExpressiveVerifyCeremony */

const Foundations = () => (
  <div className="ap" style={{ padding: 24, overflow: "auto" }}>
    <div className="col gap-2" style={{ marginBottom: 20 }}>
      <span className="tiny muted">Style guide · docs/style-guide.md</span>
      <h1 style={{ fontSize: 26 }}>Design system — by the book</h1>
      <p className="muted small" style={{ maxWidth: 600 }}>Light, airy, modern. White-label ready. Anti-cliché — abstract geometry over varsity tropes. Translucent &ldquo;soft&rdquo; badges everywhere, sentence case copy.</p>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
      {/* Brand colors */}
      <div className="card-soft" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Brand · Hyper-Violet</h3>
        <div className="row gap-2">
          {[
            ["#9333EA", "brand", "primary"],
            ["#7C22D0", "brand-hover", "hover"],
            ["#6B21A8", "brand-dark", "dark"],
          ].map(([hex, t, l]) => (
            <div key={t} className="col" style={{ flex: 1, gap: 6 }}>
              <div style={{ background: hex, height: 80, borderRadius: 12 }} />
              <div className="col">
                <span className="strong small">{l}</span>
                <span className="tiny mono muted">{hex}</span>
                <span className="tiny muted">--color-{t}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Accent */}
      <div className="card-soft" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Functional accents</h3>
        <div className="row gap-2">
          {[
            ["#06B6D4", "Cyan", "verified / active nav"],
            ["#10B981", "Emerald", "success / verified"],
            ["#F59E0B", "Amber", "warning / pending"],
            ["#F43F5E", "Coral", "alert / destructive"],
          ].map(([hex, l, u]) => (
            <div key={l} className="col" style={{ flex: 1, gap: 6 }}>
              <div style={{ background: hex, height: 80, borderRadius: 12 }} />
              <div className="col">
                <span className="strong small">{l}</span>
                <span className="tiny mono muted">{hex}</span>
                <span className="tiny muted">{u}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Type */}
      <div className="card-soft" style={{ padding: 18, gridColumn: "span 2" }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Typography</h3>
        <div className="row gap-4">
          <div className="col" style={{ flex: 1, gap: 8, paddingRight: 18, borderRight: "1px solid var(--color-border)" }}>
            <Badge tone="brand">Display</Badge>
            <span className="display" style={{ fontSize: 40, fontWeight: 700, letterSpacing: "-0.025em" }}>Space Grotesk</span>
            <span className="tiny muted">SemiBold 600 · Bold 700 · for H1–H3, prominent UI numbers, team hub titles</span>
            <div className="row gap-3" style={{ marginTop: 8, alignItems: "baseline" }}>
              <span className="display strong" style={{ fontSize: 36, letterSpacing: "-0.02em" }}>Aa</span>
              <span className="display strong" style={{ fontSize: 36, letterSpacing: "-0.02em" }}>14</span>
              <span className="display strong" style={{ fontSize: 36, letterSpacing: "-0.02em" }}>9.2</span>
            </div>
          </div>
          <div className="col" style={{ flex: 1, gap: 8 }}>
            <Badge tone="cyan">Body / UI</Badge>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 32, fontWeight: 500 }}>Inter</span>
            <span className="tiny muted">Regular 400 · Medium 500 · SemiBold 600 · body, stats, tables, microcopy</span>
            <div className="col gap-1" style={{ marginTop: 8 }}>
              <span className="small">Body 14 · regular &nbsp; <span className="strong">SemiBold</span></span>
              <span className="tiny muted">Tiny 11 · for labels, dates, captions</span>
            </div>
          </div>
        </div>
      </div>

      {/* Surfaces + radii */}
      <div className="card-soft" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Surfaces &amp; tokens</h3>
        <div className="col gap-2 small">
          {[
            ["bg", "#F8FAFC", "Page (Frost)"],
            ["card", "#FFFFFF", "Cards, sidebar"],
            ["hover", "#F1F5F9", "Interactive hover"],
            ["active", "#E2E8F0", "Pressed, dividers"],
          ].map(([k, hex, u]) => (
            <div key={k} className="row gap-3" style={{ padding: 6, borderRadius: 8 }}>
              <div style={{ width: 56, height: 32, background: hex, borderRadius: 8, border: "1px solid var(--color-border)" }} />
              <div className="col" style={{ flex: 1 }}>
                <span className="strong">surface-{k}</span>
                <span className="tiny muted">{u}</span>
              </div>
              <span className="tiny mono muted">{hex}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      <div className="card-soft" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Soft badges <span className="tiny muted" style={{ fontWeight: 400 }}>· translucent, never solid</span></h3>
        <div className="col gap-3">
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <Badge tone="brand">Brand</Badge>
            <Badge tone="cyan"><VerifiedTick size={10} /> Verified</Badge>
            <Badge tone="lime" dot>Going</Badge>
            <Badge tone="amber" dot>Pending</Badge>
            <Badge tone="coral" dot>Conflict</Badge>
            <Badge tone="slate" dot>Roster only</Badge>
          </div>
          <div className="row gap-2" style={{ flexWrap: "wrap" }}>
            <span style={{ padding: "2px 8px", borderRadius: 999, background: "#7c22d0", color: "#fff", fontSize: 11, fontWeight: 600 }}>Don't</span>
            <span className="tiny muted">Solid dark = enterprise. We use 12–15% opacity fill + 100% opacity text.</span>
          </div>
        </div>
      </div>

      {/* Components */}
      <div className="card-soft" style={{ padding: 18, gridColumn: "span 2" }}>
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Components</h3>
        <div className="row gap-4" style={{ flexWrap: "wrap" }}>
          <div className="col gap-2"><span className="tiny muted">Primary</span><Btn kind="primary" icon={I.bolt}>Verify stat</Btn></div>
          <div className="col gap-2"><span className="tiny muted">Ghost</span><Btn kind="ghost" icon={I.share}>Share profile</Btn></div>
          <div className="col gap-2"><span className="tiny muted">Subtle</span><Btn kind="subtle">Save draft</Btn></div>
          <div className="col gap-2"><span className="tiny muted">Coral</span><Btn kind="coral">Remove athlete</Btn></div>
          <div className="col gap-2"><span className="tiny muted">Card</span>
            <div className="card" style={{ padding: 10, width: 180 }}>
              <span className="strong small">Maya Castellanos</span>
              <div className="tiny muted">Forward · #9</div>
            </div>
          </div>
          <div className="col gap-2"><span className="tiny muted">Stat tile</span>
            <Stat label="Goals" value="14" verified hint="this season" />
          </div>
          <div className="col gap-2"><span className="tiny muted">Completion ring</span><Ring value={84} size={56} /></div>
          <div className="col gap-2"><span className="tiny muted">Event chip</span><EventChip type="game" title="vs Riverside" time="Sat 11a" team="Bayview U-17" /></div>
        </div>
      </div>
    </div>
  </div>
);

// ============ EXPRESSIVE VARIATION ROW ============

// Expressive public profile — editorial, big type, dramatic numerics
const ExpressivePublicProfile = () => (
  <div className="ap" style={{ background: "#0f1115", color: "#fff" }}>
    <style>{`
      .exp-bg { background: radial-gradient(circle at 20% -10%, rgba(147,51,234,0.35), transparent 50%),
                          radial-gradient(circle at 100% 100%, rgba(6,182,212,0.20), transparent 50%),
                          #0f1115; color: #fff; }
      .exp-bg h1, .exp-bg h2, .exp-bg h3 { color: #fff; }
      .exp-bg .muted { color: rgba(255,255,255,0.55); }
      .exp-bg .card-soft, .exp-bg .card { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.10); color: #fff; }
      .exp-bg .hr { background: rgba(255,255,255,0.1); }
    `}</style>
    <div className="exp-bg" style={{ height: "100%", overflow: "auto" }}>
      {/* Slim header */}
      <div className="row between" style={{ padding: "16px 36px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="row gap-3">
          <Logo size={22} />
          <span className="tiny" style={{ color: "rgba(255,255,255,0.5)" }} className="mono">athportal.io/p/maya-c</span>
        </div>
        <div className="row gap-2">
          <button className="btn ghost sm" style={{ background: "transparent", borderColor: "rgba(255,255,255,0.18)", color: "#fff" }}>{I.share}Share</button>
          <Btn kind="primary" size="sm">Save athlete</Btn>
        </div>
      </div>

      {/* HERO */}
      <div style={{ padding: "60px 64px 48px", display: "grid", gridTemplateColumns: "1fr 360px", gap: 56, alignItems: "end" }}>
        <div className="col gap-3">
          <div className="row gap-2"><Badge tone="brand">2026 Spring</Badge><Badge tone="lime"><VerifiedTick size={11} /> Coach-signed record</Badge></div>
          <h1 className="display" style={{ fontSize: 96, lineHeight: 0.92, letterSpacing: "-0.045em", fontWeight: 700 }}>
            Maya<br />
            <span style={{ fontStyle: "italic", fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>Castellanos</span>
          </h1>
          <div className="row gap-3 small" style={{ color: "rgba(255,255,255,0.7)", marginTop: 12 }}>
            <span>Forward · #9</span><span>·</span>
            <span>5′ 7″ · Right foot</span><span>·</span>
            <span>Class of 2027</span><span>·</span>
            <span>San Mateo, CA</span>
          </div>
        </div>

        <div className="col gap-3">
          <div className="ph" style={{ aspectRatio: "3 / 4", borderRadius: 16, background: "linear-gradient(180deg, #5b21b6, #0f1115)", border: "1px solid rgba(255,255,255,0.1)" }}>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>{`<portrait · 3:4>`}</span>
          </div>
          <div className="row gap-2"><Avatar name="Bayview United" size={28} hue={270} /><span className="small">Bayview United · U-17</span><div style={{ flex: 1 }} /><Avatar name="Lincoln HS" size={28} hue={200} /><span className="small">Lincoln HS</span></div>
        </div>
      </div>

      {/* Big numbers row */}
      <div style={{ padding: "0 64px 56px" }}>
        <div className="row between" style={{ marginBottom: 18 }}>
          <span className="tiny" style={{ color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.14em" }}>The record · 16 matches · 1 184 minutes</span>
          <div className="row gap-2"><VerifiedTick size={12} /><span className="tiny" style={{ color: "rgba(255,255,255,0.6)" }}>Signed by Coach Diego Park · 2h ago</span></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, borderTop: "1px solid rgba(255,255,255,0.12)", borderBottom: "1px solid rgba(255,255,255,0.12)" }}>
          {[
            { v: "14", l: "Goals", t: "+3 last 5" },
            { v: "9", l: "Assists", t: "+2 last 5" },
            { v: "62%", l: "On target", t: "44 / 71" },
            { v: "78%", l: "Pass acc.", t: "league P75" },
            { v: "44", l: "Tackles won", t: "11 per 90" },
          ].map((s, i) => (
            <div key={i} className="col" style={{ padding: "28px 22px", borderLeft: i ? "1px solid rgba(255,255,255,0.10)" : "none" }}>
              <span className="display" style={{ fontSize: 68, lineHeight: 1, fontWeight: 700, letterSpacing: "-0.04em" }}>{s.v}</span>
              <span className="tiny" style={{ marginTop: 8, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.l}</span>
              <span className="tiny" style={{ marginTop: 4, color: "#a5f3fc" }}>{s.t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Editorial body */}
      <div style={{ padding: "0 64px 64px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48 }}>
        <div className="col gap-4">
          <div>
            <span className="tiny" style={{ color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.14em" }}>The reel</span>
            <h2 className="display" style={{ fontSize: 28, marginTop: 6, marginBottom: 14, fontWeight: 600 }}>Season highlights · Spring 2026</h2>
            <div className="ph" style={{ aspectRatio: "16 / 9", borderRadius: 12, background: "linear-gradient(135deg, #5b21b6, #0f1115)", border: "1px solid rgba(255,255,255,0.1)", position: "relative" }}>
              <span style={{ color: "rgba(255,255,255,0.5)" }}>{`<Mux player>`}</span>
              <span style={{ position: "absolute", inset: 0, margin: "auto", width: 56, height: 56, borderRadius: 999, background: "#fff", color: "var(--color-brand)", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                <Icon d={<path d="M8 5v14l11-7L8 5Z" />} size={26} fill="currentColor" stroke="none" />
              </span>
              <span style={{ position: "absolute", bottom: 14, left: 14, padding: "4px 10px", background: "rgba(0,0,0,0.55)", borderRadius: 999, fontSize: 11, fontWeight: 600 }}>2:14</span>
            </div>
          </div>

          <div>
            <span className="tiny" style={{ color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.14em" }}>The story</span>
            <p className="display" style={{ fontSize: 22, lineHeight: 1.4, fontWeight: 500, marginTop: 8, color: "rgba(255,255,255,0.92)" }}>
              A right-foot finisher with a habit of finding space in the half-spaces.
              Two seasons at Bayview United and a varsity debut at Lincoln HS. Targeting D1 programs with an academic emphasis on biology.
            </p>
          </div>
        </div>

        <div className="col gap-5">
          <div>
            <span className="tiny" style={{ color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.14em" }}>Trust chain</span>
            <h2 className="display" style={{ fontSize: 28, marginTop: 6, marginBottom: 18, fontWeight: 600 }}>How this record holds up</h2>
            <div className="col gap-3">
              {[
                { who: "Bayview United FC", r: "Organization · founded 2016" },
                { who: "Coach Diego Park", r: "Head Coach · SafeSport current · signs verified stats" },
                { who: "Maya Castellanos", r: "Owns this profile" },
              ].map((c, i) => (
                <div key={i} className="row gap-3" style={{ padding: "14px 0", borderTop: i ? "1px solid rgba(255,255,255,0.1)" : "none" }}>
                  <span className="display" style={{ fontSize: 32, fontWeight: 700, color: "rgba(255,255,255,0.4)", width: 38 }}>0{i+1}</span>
                  <div className="col" style={{ flex: 1 }}>
                    <div className="row gap-2"><span className="strong">{c.who}</span><VerifiedTick size={12} /></div>
                    <span className="tiny" style={{ color: "rgba(255,255,255,0.55)" }}>{c.r}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="tiny" style={{ color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.14em" }}>Career</span>
            <div className="col gap-3" style={{ marginTop: 12 }}>
              {[
                ["2026", "NorCal U-17 Player of the Month — April"],
                ["2025", "Captain · U-16 cup champions"],
                ["2024", "ECNL Regional XI selection"],
              ].map(([y, t]) => (
                <div key={y} className="row gap-3" style={{ alignItems: "baseline" }}>
                  <span className="display mono" style={{ fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>{y}</span>
                  <span className="small" style={{ flex: 1 }}>{t}</span>
                  <VerifiedTick size={12} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// Expressive athlete home — magazine layout, big typographic hero
const ExpressiveAthleteHome = () => (
  <div className="ap">
    <style>{`
      .mag-shell { background: #faf7f2; }
      .mag-hero { background: #0f1115; color: #fff; border-radius: 20px; padding: 28px; position: relative; overflow: hidden; }
      .mag-bigtype { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.04em; line-height: 0.95; }
    `}</style>
    <div className="shell mag-shell">
      <Sidebar persona="athlete" active="Home" />
      <div className="content">
        <Topbar actions={<><Btn kind="primary" size="sm" icon={I.upload}>Upload reel</Btn></>} />
        <div className="main">
          {/* Hero card */}
          <div className="mag-hero" style={{ marginBottom: 22, display: "grid", gridTemplateColumns: "1fr 320px", gap: 28, alignItems: "stretch" }}>
            <div className="col" style={{ justifyContent: "space-between" }}>
              <div className="row gap-2">
                <Badge tone="brand">Week 16 of 22</Badge>
                <span className="tiny" style={{ color: "rgba(255,255,255,0.55)" }}>Spring season · Bayview United</span>
              </div>
              <div className="col gap-3" style={{ margin: "20px 0" }}>
                <span className="tiny" style={{ color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: "0.16em" }}>Welcome back, Maya</span>
                <span className="mag-bigtype" style={{ fontSize: 64, color: "#fff" }}>
                  14 goals.<br />
                  <span style={{ color: "rgba(255,255,255,0.65)", fontStyle: "italic", fontWeight: 500 }}>9 assists.</span><br />
                  <span style={{ color: "#a5f3fc" }}>One match left.</span>
                </span>
              </div>
              <div className="row gap-3" style={{ alignItems: "center" }}>
                <Btn kind="primary" icon={I.bolt}>Finish profile (3 fields)</Btn>
                <span className="tiny" style={{ color: "rgba(255,255,255,0.5)" }}>Unlock the Recruiter-ready badge</span>
              </div>
            </div>
            <div className="col gap-3" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 14, padding: 18 }}>
              <span className="tiny" style={{ color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.1em" }}>This Saturday</span>
              <span className="display strong" style={{ fontSize: 22, color: "#fff" }}>vs Riverside Strikers</span>
              <span className="tiny" style={{ color: "rgba(255,255,255,0.55)" }}>Bayview Stadium · 11:00 AM</span>
              <hr className="hr" style={{ background: "rgba(255,255,255,0.1)" }} />
              <div className="col gap-2">
                <span className="tiny" style={{ color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Pre-match brief from Coach Park</span>
                <p className="small" style={{ color: "rgba(255,255,255,0.85)" }}>Half-space runs theme. Look for the pocket between their RB and CB.</p>
              </div>
              <div className="row gap-2" style={{ marginTop: "auto" }}>
                <Btn kind="primary" size="sm" icon={I.check} style={{ flex: 1 }}>Going</Btn>
                <Btn kind="ghost" size="sm" style={{ flex: 1, background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}>Maybe</Btn>
              </div>
            </div>
          </div>

          {/* Editorial grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 14, marginBottom: 22 }}>
            {[
              { l: "Goals this season", v: "14", t: "+3 last 5 matches", color: "var(--color-brand)" },
              { l: "Verified rate", v: "100%", t: "every stat signed", color: "var(--color-action-lime)" },
              { l: "Profile views", v: "238", t: "↑ 42% vs last month", color: "var(--color-action-cyan)" },
            ].map((s, i) => (
              <div key={i} className="card-soft" style={{ padding: 22, background: "#fff" }}>
                <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.l}</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
                  <span className="display" style={{ fontSize: 56, fontWeight: 700, letterSpacing: "-0.04em", color: s.color }}>{s.v}</span>
                </div>
                <span className="small muted" style={{ marginTop: 4, display: "block" }}>{s.t}</span>
              </div>
            ))}
          </div>

          {/* Two columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 16 }}>
            <div className="card-soft" style={{ padding: 22, background: "#fff" }}>
              <div className="row between" style={{ marginBottom: 14 }}>
                <h3 className="display" style={{ fontSize: 20 }}>The trust chain</h3>
                <Badge tone="lime"><VerifiedTick size={11} /> Active</Badge>
              </div>
              <div className="col gap-3">
                {[
                  { tag: "Org", who: "Bayview United FC", r: "vouches for the U-17 team", n: "01" },
                  { tag: "Coach", who: "Diego Park", r: "signs your stats · 14 verified this season", n: "02" },
                  { tag: "You", who: "Maya Castellanos", r: "owns this profile · 238 views in 30 days", n: "03" },
                ].map((c, i) => (
                  <div key={i} className="row gap-4" style={{ padding: "10px 0", borderTop: i ? "1px solid var(--color-border)" : "none", alignItems: "center" }}>
                    <span className="display" style={{ fontSize: 28, fontWeight: 700, color: "var(--color-border-strong)", width: 34 }}>{c.n}</span>
                    <div className="col" style={{ flex: 1 }}>
                      <div className="row gap-2"><Badge tone={i === 0 ? "amber" : i === 1 ? "cyan" : "brand"}>{c.tag}</Badge><span className="strong">{c.who}</span></div>
                      <span className="tiny muted">{c.r}</span>
                    </div>
                    <VerifiedTick size={14} />
                  </div>
                ))}
              </div>
            </div>

            <div className="card-soft" style={{ padding: 22, background: "#fff" }}>
              <h3 className="display" style={{ fontSize: 20, marginBottom: 12 }}>What's pending</h3>
              <div className="col gap-3">
                {[
                  { l: "Cover photo", h: "Recruiters scan this first", c: "amber" },
                  { l: "Highlight reel", h: "Unlocks Recruiter-ready", c: "amber" },
                  { l: "Academic info", h: "GPA, transcript, grad year", c: "amber" },
                ].map((t, i) => (
                  <div key={i} className="row gap-3" style={{ padding: 12, border: "1px dashed var(--color-border)", borderRadius: 10 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 999, background: `color-mix(in srgb, var(--color-action-${t.c}) 12%, white)`, color: t.c === "amber" ? "#b45309" : "#047857", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{i+1}</span>
                    <div className="col" style={{ flex: 1 }}>
                      <span className="strong small">{t.l}</span>
                      <span className="tiny muted">{t.h}</span>
                    </div>
                    {I.chev}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// Verify ceremony — focus modal as a hero card
const ExpressiveVerifyCeremony = () => (
  <div className="ap" style={{ background: "#f0eee9", padding: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div className="card-soft" style={{ padding: 0, width: "100%", maxWidth: 720, overflow: "hidden", boxShadow: "0 30px 90px rgba(15,17,21,0.15), 0 0 0 1px rgba(15,17,21,0.05)" }}>
      {/* Header */}
      <div style={{ padding: "22px 28px", borderBottom: "1px solid var(--color-border)", background: "linear-gradient(180deg, #fafafe, #fff)" }}>
        <div className="row between">
          <Badge tone="brand">Coach signature</Badge>
          <span className="tiny muted">Audit-logged · Sat 18 May 2026 · 11:42 AM</span>
        </div>
        <h1 className="display" style={{ fontSize: 32, marginTop: 12, lineHeight: 1.05 }}>
          Sign Maya's stats from <em style={{ fontWeight: 500, color: "var(--color-text-secondary)" }}>vs Oak Valley</em>.
        </h1>
        <p className="muted small" style={{ marginTop: 6 }}>Each signature attaches your coach credential. This is what makes the record portable.</p>
      </div>

      <div style={{ padding: "22px 28px" }}>
        <div className="row gap-3" style={{ marginBottom: 22 }}>
          <Avatar name="Maya Castellanos" size={56} hue={270} />
          <div className="col" style={{ flex: 1 }}>
            <span className="display strong" style={{ fontSize: 18 }}>Maya Castellanos · #9</span>
            <span className="tiny muted">Bayview United · U-17 · Forward</span>
          </div>
          <Badge tone="lime"><VerifiedTick size={11} /> Sideline source</Badge>
        </div>

        {/* Stats reveal */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}>
          {[
            { v: "2", l: "Goals" },
            { v: "1", l: "Assist" },
            { v: "6", l: "Shots on target" },
          ].map((s, i) => (
            <div key={i} className="col" style={{ padding: 22, alignItems: "center", borderLeft: i ? "1px solid var(--color-border)" : "none" }}>
              <span className="display" style={{ fontSize: 64, fontWeight: 700, color: "var(--color-brand)", letterSpacing: "-0.04em", lineHeight: 1 }}>{s.v}</span>
              <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.1em", marginTop: 8 }}>{s.l}</span>
            </div>
          ))}
        </div>

        {/* Signature block */}
        <div style={{ padding: "22px 0 4px" }}>
          <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>Sign as</span>
          <div className="row gap-3" style={{ marginTop: 10, alignItems: "center" }}>
            <Avatar name="Diego Park" size={44} hue={200} />
            <div className="col" style={{ flex: 1 }}>
              <span className="display" style={{ fontSize: 22, fontStyle: "italic", fontWeight: 600, color: "var(--color-text-primary)", borderBottom: "2px solid var(--color-text-primary)", paddingBottom: 2, alignSelf: "flex-start" }}>Diego Park</span>
              <span className="tiny muted" style={{ marginTop: 6 }}>Head coach, Bayview United U-17 · SafeSport current</span>
            </div>
          </div>
        </div>

        <label className="row gap-2 small" style={{ marginTop: 18 }}>
          <input type="checkbox" defaultChecked />
          <span>I personally witnessed these stats or reviewed the sideline feed.</span>
        </label>
        <label className="row gap-2 small" style={{ marginTop: 8 }}>
          <input type="checkbox" defaultChecked />
          <span>Add to Maya's public profile and notify her.</span>
        </label>

        <div className="row gap-2" style={{ marginTop: 22 }}>
          <Btn kind="ghost" style={{ flex: 1 }}>Cancel</Btn>
          <Btn kind="primary" icon={<VerifiedTick size={14} />} style={{ flex: 2 }}>Sign &amp; verify 3 stats</Btn>
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, { Foundations, ExpressivePublicProfile, ExpressiveAthleteHome, ExpressiveVerifyCeremony });
