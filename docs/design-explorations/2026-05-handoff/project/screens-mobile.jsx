/* Mobile PWA artboards: AthleteHomeMobile, PublicProfileMobile, CalendarMobile, VerifyMobile */

const MStatus = () => (
  <div className="row between" style={{ padding: "8px 18px 0", fontSize: 12, color: "var(--color-text-primary)" }}>
    <span className="strong mono">9:41</span>
    <div className="row gap-1" style={{ alignItems: "center" }}>
      <span style={{ fontSize: 11 }}>5G</span>
      <span style={{ width: 22, height: 11, border: "1px solid currentColor", borderRadius: 3, position: "relative" }}>
        <span style={{ position: "absolute", inset: 1, width: "85%", background: "currentColor", borderRadius: 1 }} />
      </span>
    </div>
  </div>
);

const MTabbar = ({ active = "Home" }) => {
  const items = [
    ["Home", I.home],
    ["Calendar", I.calendar],
    ["Feed", I.feed],
    ["Profile", I.profile],
  ];
  return (
    <div className="row between" style={{
      position: "absolute", left: 0, right: 0, bottom: 0,
      padding: "8px 18px 22px", background: "var(--color-surface-card)",
      borderTop: "1px solid var(--color-border)",
    }}>
      {items.map(([l, i]) => (
        <div key={l} className="col" style={{ alignItems: "center", gap: 2, color: active === l ? "var(--color-brand)" : "var(--color-text-secondary)", flex: 1 }}>
          {i}<span style={{ fontSize: 10, fontWeight: 600 }}>{l}</span>
        </div>
      ))}
    </div>
  );
};

const MFrame = ({ children }) => (
  <div className="ap" style={{ background: "#0f1115", padding: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{
      width: 343, height: 740, borderRadius: 38, background: "var(--color-surface-card)",
      boxShadow: "0 20px 60px rgba(0,0,0,0.35), inset 0 0 0 6px #1c1f25",
      overflow: "hidden", position: "relative", border: "10px solid #1c1f25",
    }}>
      <div className="ap" style={{ height: "100%", width: "100%", borderRadius: 28 }}>{children}</div>
    </div>
  </div>
);

const AthleteHomeMobile = () => (
  <MFrame>
    <MStatus />
    <div style={{ padding: "12px 18px 8px" }}>
      <div className="row between">
        <Logo size={20} label={null} />
        <div className="row gap-2">
          <button className="btn ghost sm" style={{ height: 30 }}>{I.bell}</button>
          <Avatar name="Maya Castellanos" size={30} hue={270} />
        </div>
      </div>
    </div>

    <div style={{ overflow: "auto", height: "calc(100% - 110px)", padding: "0 18px 18px" }}>
      <div className="col gap-1" style={{ margin: "8px 0 14px" }}>
        <span className="tiny muted">Wednesday, 21 May</span>
        <h1 style={{ fontSize: 24, lineHeight: 1.1 }}>Hi, Maya 👋</h1>
      </div>

      {/* Profile completion */}
      <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", background: "color-mix(in srgb, var(--color-brand) 5%, white)" }}>
        <Ring value={84} size={52} stroke={5} />
        <div className="col" style={{ flex: 1 }}>
          <span className="strong small">Recruiter-ready</span>
          <span className="tiny muted">3 fields to go</span>
        </div>
        {I.chev}
      </div>

      {/* Next event */}
      <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Next up</span>
      <div className="card" style={{ padding: 14, marginTop: 6, marginBottom: 16, borderLeft: "3px solid var(--color-action-coral)" }}>
        <div className="row gap-2"><Badge tone="coral" dot>Game · Sat</Badge><span className="tiny muted">11:00 AM</span></div>
        <span className="strong" style={{ display: "block", fontSize: 15, marginTop: 6 }}>vs Riverside Strikers</span>
        <span className="tiny muted">Bayview Stadium · Pitch 1</span>
        <div className="row gap-2" style={{ marginTop: 10 }}>
          <Btn kind="primary" size="sm" icon={I.check} style={{ flex: 1 }}>Going</Btn>
          <Btn kind="ghost" size="sm" style={{ flex: 1 }}>Maybe</Btn>
        </div>
      </div>

      {/* Stat row */}
      <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Season verified</span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6, marginBottom: 14 }}>
        <Stat label="Goals" value="14" verified />
        <Stat label="Assists" value="9" verified />
      </div>

      {/* Notifications */}
      <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Recent</span>
      <div className="col gap-2" style={{ marginTop: 6 }}>
        {[
          { who: "Coach Park", what: "verified 2 goals vs Oak Valley", t: "2h", c: "lime", i: <VerifiedTick size={12} /> },
          { who: "Lily Ahn", what: "tagged you in a post", t: "5h", c: "brand", i: I.feed },
          { who: "Bayview FC", what: "added you to Lincoln HS roster", t: "1d", c: "cyan", i: I.team },
        ].map((n, i) => (
          <div key={i} className="row gap-3 card" style={{ padding: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "var(--color-surface-hover)", display: "flex", alignItems: "center", justifyContent: "center" }}>{n.i}</div>
            <div className="col" style={{ flex: 1 }}>
              <span className="small"><span className="strong">{n.who}</span> <span className="muted">{n.what}</span></span>
              <span className="tiny muted">{n.t} ago</span>
            </div>
          </div>
        ))}
      </div>
    </div>
    <MTabbar active="Home" />
  </MFrame>
);

const PublicProfileMobile = () => (
  <MFrame>
    <MStatus />
    <div className="row between" style={{ padding: "8px 18px 4px" }}>
      <button className="btn ghost sm" style={{ height: 30 }}>← Back</button>
      <div className="row gap-2">
        <button className="btn ghost sm" style={{ height: 30 }}>{I.share}</button>
        <button className="btn ghost sm" style={{ height: 30 }}>{I.heart}</button>
      </div>
    </div>

    <div style={{ overflow: "auto", height: "calc(100% - 70px)" }}>
      <div className="ph" style={{ aspectRatio: "3 / 1.6", borderRadius: 0, border: "none", position: "relative" }}>
        <span>{`<cover>`}</span>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(15,17,21,0) 50%, rgba(15,17,21,0.45) 100%)" }} />
      </div>
      <div style={{ padding: "0 18px", marginTop: -32, position: "relative" }}>
        <Avatar name="Maya Castellanos" size={64} hue={270} />
        <div className="col" style={{ marginTop: 8 }}>
          <div className="row gap-2"><h2 style={{ fontSize: 20 }}>Maya Castellanos</h2><VerifiedTick size={14} /></div>
          <span className="tiny muted">Forward · #9 · Class of 2027</span>
          <div className="row gap-2 tiny muted" style={{ marginTop: 4 }}>
            <span>5′ 7″</span>·<span>Right foot</span>·<span>San Mateo, CA</span>
          </div>
        </div>

        <div className="row gap-2" style={{ marginTop: 14 }}>
          <Btn kind="primary" icon={I.heart} style={{ flex: 1 }}>Save</Btn>
          <Btn kind="ghost" icon={I.share} style={{ flex: 1 }}>Share</Btn>
        </div>

        <div className="row" style={{ gap: 8, marginTop: 16, overflowX: "auto", paddingBottom: 8 }}>
          {["Overview", "Stats", "Reel", "Career", "Teams"].map((t, i) => (
            <div key={t} style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600,
              color: i === 0 ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              borderBottom: i === 0 ? "2px solid var(--color-brand)" : "2px solid transparent",
              whiteSpace: "nowrap" }}>{t}</div>
          ))}
        </div>

        <div className="card" style={{ padding: 14, marginTop: 12, background: "color-mix(in srgb, var(--color-action-lime) 6%, white)", borderColor: "color-mix(in srgb, var(--color-action-lime) 30%, transparent)" }}>
          <div className="row gap-2"><Badge tone="lime"><VerifiedTick size={11} /> Verified by Coach Park</Badge></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
            {[["14", "Goals"], ["9", "Assists"], ["62%", "On target"]].map(([v, l]) => (
              <div key={l} className="col" style={{ alignItems: "center" }}>
                <span className="display strong" style={{ fontSize: 22 }}>{v}</span>
                <span className="tiny muted">{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <div className="row between" style={{ marginBottom: 8 }}><span className="strong small">Featured reel</span><span className="tiny muted">2:14</span></div>
          <div className="ph" style={{ aspectRatio: "16 / 9", borderRadius: 10, position: "relative" }}><span>{`<video>`}</span>
            <span style={{ position: "absolute", inset: 0, margin: "auto", width: 36, height: 36, borderRadius: 999, background: "rgba(255,255,255,0.94)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--color-brand)", padding: 0 }}>▶</span>
          </div>
        </div>

        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <span className="strong small">Trust chain</span>
          <div className="col gap-2 tiny" style={{ marginTop: 8 }}>
            <div className="row gap-2"><VerifiedTick size={11} /><span>Bayview United FC vouches for U-17 team</span></div>
            <div className="row gap-2"><VerifiedTick size={11} /><span>Coach Park signed 14 verified stats</span></div>
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  </MFrame>
);

const CalendarMobile = () => (
  <MFrame>
    <MStatus />
    <div style={{ padding: "12px 18px 8px" }}>
      <div className="row between">
        <div className="col"><span className="tiny muted">May 2026</span><h2 style={{ fontSize: 20 }}>This week</h2></div>
        <button className="btn ghost sm" style={{ height: 30 }}>{I.plus}</button>
      </div>
    </div>

    {/* Week strip */}
    <div className="row" style={{ padding: "0 18px", gap: 8 }}>
      {[
        { d: "M", n: 18, ev: 1 },
        { d: "T", n: 19, ev: 1 },
        { d: "W", n: 20, ev: 0 },
        { d: "T", n: 21, ev: 2, today: true },
        { d: "F", n: 22, ev: 1 },
        { d: "S", n: 23, ev: 0 },
        { d: "S", n: 24, ev: 1 },
      ].map((d, i) => (
        <div key={i} className="col" style={{ alignItems: "center", flex: 1,
          padding: 8, borderRadius: 12,
          background: d.today ? "var(--color-brand)" : "transparent",
          color: d.today ? "#fff" : "var(--color-text-primary)" }}>
          <span className="tiny" style={{ opacity: 0.7 }}>{d.d}</span>
          <span className="display strong" style={{ fontSize: 16 }}>{d.n}</span>
          {d.ev > 0 && <div style={{ width: 5, height: 5, borderRadius: 999, background: d.today ? "#fff" : "var(--color-brand)", marginTop: 4 }} />}
        </div>
      ))}
    </div>

    <div style={{ overflow: "auto", height: "calc(100% - 200px)", padding: "16px 18px 18px" }}>
      <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Thursday, May 21</span>
      <div className="col gap-2" style={{ marginTop: 8, marginBottom: 14 }}>
        {[
          { t: "training", title: "Recovery · pool", time: "6:00 – 7:00 AM", v: "Bayview Aquatic", rsvp: "going" },
          { t: "practice", title: "Tactical session · final third", time: "5:30 – 7:00 PM", v: "Pitch 3", rsvp: "going" },
        ].map((e, i) => (
          <div key={i} className="card" style={{ padding: 12, borderLeft: `3px solid ${e.t === "game" ? "#f43f5e" : e.t === "practice" ? "#06b6d4" : "#10b981"}` }}>
            <div className="row gap-2"><Badge tone={e.t === "practice" ? "cyan" : "lime"}>{e.t}</Badge><span className="tiny muted">{e.time}</span></div>
            <span className="strong" style={{ display: "block", marginTop: 4 }}>{e.title}</span>
            <span className="tiny muted">{e.v}</span>
            <div className="row gap-2" style={{ marginTop: 8 }}>
              <Badge tone="lime" dot>RSVP'd · going</Badge>
            </div>
          </div>
        ))}
      </div>

      <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Saturday, May 24</span>
      <div className="card" style={{ padding: 12, marginTop: 8, borderLeft: "3px solid var(--color-action-coral)" }}>
        <div className="row gap-2"><Badge tone="coral" dot>Game · Home</Badge><span className="tiny muted">11:00 AM</span></div>
        <span className="strong" style={{ display: "block", marginTop: 4 }}>vs Riverside Strikers</span>
        <span className="tiny muted">Bayview Stadium · Pitch 1</span>
        <div className="row gap-2" style={{ marginTop: 8 }}>
          <Btn kind="primary" size="sm" icon={I.check}>Going</Btn>
          <Btn kind="ghost" size="sm">Maybe</Btn>
        </div>
      </div>
    </div>
    <MTabbar active="Calendar" />
  </MFrame>
);

const VerifyMobile = () => (
  <MFrame>
    <MStatus />
    <div className="row between" style={{ padding: "8px 18px 4px" }}>
      <button className="btn ghost sm" style={{ height: 30 }}>← Back</button>
      <Badge tone="brand">2 of 3</Badge>
    </div>

    <div style={{ padding: "8px 18px 18px", overflow: "auto", height: "calc(100% - 60px)" }}>
      <span className="tiny muted">Sideline submission</span>
      <h1 style={{ fontSize: 22, marginTop: 2 }}>Sign these stats?</h1>
      <p className="tiny muted" style={{ marginTop: 4 }}>vs Oak Valley · 18 May · W 3–1</p>

      <div className="card" style={{ padding: 14, marginTop: 14, display: "flex", gap: 12, alignItems: "center" }}>
        <Avatar name="Maya Castellanos" size={48} hue={270} />
        <div className="col" style={{ flex: 1 }}>
          <span className="strong">Maya Castellanos</span>
          <span className="tiny muted">Forward · #9 · U-17 Girls</span>
        </div>
      </div>

      <div className="col gap-2" style={{ marginTop: 14 }}>
        {[
          { k: "Goals", v: "2", ok: true, src: "Sideline tablet" },
          { k: "Assists", v: "1", ok: true, src: "Sideline tablet" },
          { k: "Shots on target", v: "6", ok: true, src: "Sideline tablet" },
          { k: "Pass accuracy", v: "81%", ok: false, src: "Athlete entered · 76% on feed", note: "Defer to data?" },
        ].map((s, i) => (
          <div key={i} className="card" style={{
            padding: 14, borderColor: s.ok ? "color-mix(in srgb, var(--color-action-lime) 30%, transparent)" : "color-mix(in srgb, var(--color-action-amber) 35%, transparent)",
            background: s.ok ? "color-mix(in srgb, var(--color-action-lime) 6%, white)" : "color-mix(in srgb, var(--color-action-amber) 8%, white)",
          }}>
            <div className="row between">
              <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.k}</span>
              {s.ok ? <VerifiedTick size={14} /> : <span style={{ width: 16, height: 16, borderRadius: 999, background: "#f59e0b", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>!</span>}
            </div>
            <span className="display strong" style={{ fontSize: 22, display: "block" }}>{s.v}</span>
            <span className="tiny muted">{s.src}</span>
            {s.note && <span className="tiny" style={{ color: "#b45309", display: "block", marginTop: 4 }}>{s.note}</span>}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 14, marginTop: 14 }}>
        <span className="tiny muted">Sign as</span>
        <input className="input" defaultValue="Diego Park" style={{ marginTop: 4, fontFamily: "var(--font-display)", fontWeight: 600 }} />
        <label className="row gap-2 tiny" style={{ marginTop: 10 }}><input type="checkbox" defaultChecked /><span>I witnessed these stats or reviewed the sideline feed.</span></label>
      </div>

      <div className="col gap-2" style={{ marginTop: 14 }}>
        <Btn kind="primary" icon={<VerifiedTick size={14} />} style={{ width: "100%", height: 44 }}>Sign &amp; verify 3 stats</Btn>
        <Btn kind="ghost" style={{ width: "100%" }}>Edit values</Btn>
        <Btn kind="coral" style={{ width: "100%" }}>Reject submission</Btn>
      </div>
    </div>
  </MFrame>
);

Object.assign(window, { AthleteHomeMobile, PublicProfileMobile, CalendarMobile, VerifyMobile });
