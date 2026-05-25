/* Calendar + Event detail + Team feed.
   Exposes: CalendarMonth, EventDetail, TeamFeed */

const CalendarMonth = () => {
  // May 2026 starts on Friday (1=Fri, 31 days).
  const month = "May 2026";
  const startDay = 5; // Friday (0=Sun)
  const days = 31;
  const totalCells = 42;
  // Sample event data keyed by date
  const events = {
    4:  [{ t: "practice", title: "Conditioning · pitch 2", time: "5:30p" }],
    5:  [{ t: "academic", title: "Player-coach review", time: "4p" }],
    7:  [{ t: "game", title: "vs Sutter Spurs (A)", time: "6:30p" }],
    9:  [{ t: "tournament", title: "NorCal Spring Cup · group", time: "9a" }, { t: "tournament", title: "NorCal · QF", time: "3p" }],
    11: [{ t: "practice", title: "Set-piece drills", time: "5:30p" }, { t: "meeting", title: "Captains 1:1", time: "7p" }],
    13: [{ t: "training", title: "Strength · gym A", time: "7a" }],
    15: [{ t: "practice", title: "Tactical session", time: "5:30p" }],
    18: [{ t: "game", title: "vs Oak Valley (H)", time: "11a", conflict: true }],
    19: [{ t: "academic", title: "Recruiter Q&A · online", time: "4p" }],
    21: [{ t: "training", title: "Recovery · pool", time: "6a" }, { t: "practice", title: "Tactical · final third", time: "5:30p" }],
    22: [{ t: "practice", title: "Walkthrough", time: "5:30p" }],
    24: [{ t: "game", title: "vs Riverside Strikers (H)", time: "11a" }],
    26: [{ t: "academic", title: "Player-coach review", time: "4p" }],
    28: [{ t: "practice", title: "Tactical session", time: "5:30p" }],
    30: [{ t: "tournament", title: "Bayview Memorial · pool", time: "10a" }, { t: "tournament", title: "Memorial · semi", time: "4p" }],
  };

  return (
    <div className="ap">
      <div className="shell">
        <Sidebar persona="athlete" active="Calendar" />
        <div className="content">
          <Topbar actions={<>
            <Btn kind="ghost" size="sm" icon={I.link}>iCal feed</Btn>
            <Btn kind="primary" size="sm" icon={I.plus}>New event</Btn>
          </>} />
          <div className="main">
            <div className="row between" style={{ marginBottom: 14 }}>
              <div className="col">
                <span className="tiny muted">Bayview United · U-17 Girls &nbsp;›&nbsp; Calendar</span>
                <h1 style={{ fontSize: 24 }}>{month}</h1>
              </div>
              <div className="row gap-2">
                <div className="row" style={{ background: "var(--color-surface-card)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
                  {["Month", "Week", "Agenda"].map((v, i) => (
                    <div key={v} style={{
                      padding: "8px 14px", fontSize: 12, fontWeight: 600,
                      background: i === 0 ? "color-mix(in srgb, var(--color-brand) 12%, transparent)" : "transparent",
                      color: i === 0 ? "var(--color-brand)" : "var(--color-text-secondary)",
                      cursor: "pointer", borderRight: i < 2 ? "1px solid var(--color-border)" : "none",
                    }}>{v}</div>
                  ))}
                </div>
                <Btn kind="ghost" size="sm">←</Btn>
                <Btn kind="ghost" size="sm">Today</Btn>
                <Btn kind="ghost" size="sm">→</Btn>
              </div>
            </div>

            {/* Filter chips */}
            <div className="row between" style={{ marginBottom: 10 }}>
              <div className="row gap-2 tiny muted">Showing
                {[{ l: "All events", a: true }, { l: "Games" }, { l: "Practices" }, { l: "Training" }, { l: "Academic" }].map((c, i) => (
                  <span key={i} style={{
                    padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                    background: c.a ? "color-mix(in srgb, var(--color-brand) 12%, white)" : "var(--color-surface-card)",
                    color: c.a ? "var(--color-brand)" : "var(--color-text-secondary)",
                    border: "1px solid " + (c.a ? "color-mix(in srgb, var(--color-brand) 28%, transparent)" : "var(--color-border)"),
                  }}>{c.l}</span>
                ))}
              </div>
              <div className="row gap-2">
                <Badge tone="coral" dot>1 conflict this month</Badge>
                <Badge tone="amber">2 RSVPs pending</Badge>
              </div>
            </div>

            <div className="card" style={{ overflow: "hidden" }}>
              {/* DOW header */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "var(--color-surface-hover)", borderBottom: "1px solid var(--color-border)" }}>
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
                  <div key={d} style={{ padding: "8px 12px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-text-secondary)" }}>{d}</div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "112px" }}>
                {Array.from({ length: totalCells }).map((_, i) => {
                  const dayNum = i - startDay + 1;
                  const inMonth = dayNum >= 1 && dayNum <= days;
                  const isToday = dayNum === 21;
                  const evs = events[dayNum] || [];
                  return (
                    <div key={i} style={{
                      borderRight: ((i + 1) % 7) ? "1px solid var(--color-border)" : "none",
                      borderTop: i >= 7 ? "1px solid var(--color-border)" : "none",
                      padding: 6, opacity: inMonth ? 1 : 0.42,
                      background: isToday ? "color-mix(in srgb, var(--color-brand) 4%, white)" : "var(--color-surface-card)",
                      display: "flex", flexDirection: "column", gap: 3, minWidth: 0, overflow: "hidden",
                    }}>
                      <div className="row between" style={{ marginBottom: 2 }}>
                        <span className="display" style={{
                          fontSize: 12, fontWeight: 600,
                          color: isToday ? "#fff" : (inMonth ? "var(--color-text-primary)" : "var(--color-text-secondary)"),
                          background: isToday ? "var(--color-brand)" : "transparent",
                          padding: isToday ? "1px 6px" : 0, borderRadius: 999, minWidth: isToday ? 22 : "auto", textAlign: "center",
                        }}>{inMonth ? dayNum : (dayNum < 1 ? 30 + dayNum : dayNum - days)}</span>
                      </div>
                      {evs.slice(0, 3).map((e, j) => (
                        <EventChip key={j} type={e.t} title={e.title} time={e.time} conflict={e.conflict} />
                      ))}
                      {evs.length > 3 && <span className="tiny muted strong">+{evs.length - 3} more</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="row gap-3" style={{ marginTop: 12 }}>
              <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>Legend</span>
              {[
                ["Game", "coral"],
                ["Practice", "cyan"],
                ["Training", "lime"],
                ["Academic", "amber"],
                ["Tournament", "brand"],
                ["Meeting", "slate"],
              ].map(([l, t]) => <Badge key={l} tone={t} dot>{l}</Badge>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------- Event detail / RSVP ----------
const EventDetail = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="athlete" active="Calendar" />
      <div className="content">
        <Topbar actions={<><Btn kind="ghost" size="sm" icon={I.share}>Share event</Btn><Btn kind="ghost" size="sm">Add to calendar</Btn></>} />
        <div className="main">
          <span className="tiny muted">Calendar &nbsp;›&nbsp; May &nbsp;›&nbsp; vs Riverside Strikers</span>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 18, marginTop: 8 }}>
            {/* Left */}
            <div className="col gap-4">
              <div className="card-soft" style={{ padding: 22 }}>
                <div className="row gap-2"><Badge tone="coral" dot>Game · Home</Badge><Badge tone="brand">League · regular season</Badge></div>
                <h1 style={{ fontSize: 30, marginTop: 10 }}>vs Riverside Strikers</h1>
                <p className="muted" style={{ marginTop: 4 }}>Bayview United U-17 Girls · Spring 2026 season match</p>

                <div className="row gap-5" style={{ marginTop: 18, padding: "12px 0", borderTop: "1px solid var(--color-border)", borderBottom: "1px solid var(--color-border)" }}>
                  {[
                    ["When", "Sat, 24 May 2026", "11:00 AM – 12:45 PM PDT"],
                    ["Where", "Bayview Stadium", "Pitch 1 · 220 W Hillsdale Blvd"],
                    ["Coach", "Diego Park", "+ Asst. Lia Reyes"],
                  ].map(([k, a, b], i) => (
                    <div key={k} className="col gap-1" style={{ flex: 1 }}>
                      <span className="tiny muted strong" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</span>
                      <span className="strong">{a}</span>
                      <span className="tiny muted">{b}</span>
                    </div>
                  ))}
                </div>

                {/* Match crest header */}
                <div className="row" style={{ alignItems: "center", justifyContent: "space-between", padding: "18px 8px" }}>
                  <div className="col" style={{ alignItems: "center", gap: 6 }}>
                    <Avatar name="Bayview United" size={56} hue={270} />
                    <span className="strong">Bayview United</span>
                    <span className="tiny muted">Home · 9W 2D 1L</span>
                  </div>
                  <div className="col" style={{ alignItems: "center" }}>
                    <span className="display" style={{ fontSize: 42, fontWeight: 700, letterSpacing: "-0.02em" }}>VS</span>
                    <span className="tiny muted">11:00 AM PDT</span>
                  </div>
                  <div className="col" style={{ alignItems: "center", gap: 6 }}>
                    <Avatar name="Riverside Strikers" size={56} hue={20} />
                    <span className="strong">Riverside Strikers</span>
                    <span className="tiny muted">Away · 7W 3D 2L</span>
                  </div>
                </div>

                <div className="row gap-2">
                  <Btn kind="primary" icon={I.check}>Going</Btn>
                  <Btn kind="ghost">Maybe</Btn>
                  <Btn kind="ghost">Can't make it</Btn>
                  <div style={{ flex: 1 }} />
                  <span className="tiny muted">Closes Friday 5 PM</span>
                </div>
              </div>

              {/* Pre-match brief */}
              <div className="card-soft" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Coach's brief</h3>
                <p className="small">
                  Riverside press high — they win the ball in the wide channels.
                  We answer with a back-3 build-up and let the wingers stretch the lines. Maya and Lily, look for the half-space
                  runs between their CB and FB. Sara, you're the release valve.
                </p>
                <div className="row gap-2" style={{ marginTop: 10 }}>
                  <Badge tone="slate">Formation 3-4-3</Badge>
                  <Badge tone="brand">Theme: half-space runs</Badge>
                  <Badge tone="cyan">Set-pieces: 3 short corners</Badge>
                </div>
              </div>
            </div>

            {/* Right */}
            <div className="col gap-4">
              <div className="card-soft" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 12 }}>Roster RSVPs <span className="tiny muted" style={{ fontWeight: 400, marginLeft: 6 }}>14 of 18</span></h3>
                <div className="col gap-2 small">
                  {[
                    { lbl: "Going", n: 14, c: "lime" },
                    { lbl: "Maybe", n: 1, c: "amber" },
                    { lbl: "Can't make it", n: 1, c: "coral" },
                    { lbl: "No response", n: 2, c: "slate" },
                  ].map((r, i) => (
                    <div key={i} className="row between" style={{ padding: "6px 0", borderTop: i ? "1px dashed var(--color-border)" : "none" }}>
                      <Badge tone={r.c} dot>{r.lbl}</Badge>
                      <span className="strong display">{r.n}</span>
                    </div>
                  ))}
                </div>
                <div className="row" style={{ gap: -8, marginTop: 12, flexWrap: "wrap" }}>
                  {["Maya", "Lily", "Sara", "Jess", "Emma", "Priya", "Kara", "Daniela"].map((n, i) => (
                    <span key={n} style={{ marginLeft: i ? -8 : 0 }}><Avatar name={n} size={28} hue={50 + i * 35} /></span>
                  ))}
                  <span className="tiny muted" style={{ marginLeft: 8, alignSelf: "center" }}>+6 more</span>
                </div>
              </div>

              <div className="card-soft" style={{ padding: 18 }}>
                <h3 style={{ fontSize: 14, marginBottom: 10 }}>Logistics</h3>
                <div className="col gap-2 small">
                  {[
                    ["Arrival", "10:15 AM (45 min before)"],
                    ["Kit", "White home"],
                    ["Travel", "Self-organized"],
                    ["Parking", "Lot B · permit not required"],
                    ["Weather", "62°F, light wind"],
                  ].map(([k, v]) => (
                    <div key={k} className="row between">
                      <span className="muted">{k}</span>
                      <span className="strong">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card-soft" style={{ padding: 18, background: "color-mix(in srgb, var(--color-action-amber) 6%, white)", borderColor: "color-mix(in srgb, var(--color-action-amber) 30%, transparent)" }}>
                <div className="row gap-2"><Badge tone="amber" dot>Heads up</Badge></div>
                <p className="small" style={{ marginTop: 8 }}>The Lincoln HS away game is the same morning at 9 AM — we marked it as a scheduling conflict on your calendar.</p>
                <Btn kind="ghost" size="sm" style={{ marginTop: 8 }}>Open conflict</Btn>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ---------- Team feed ----------
const TeamFeed = () => (
  <div className="ap">
    <div className="shell">
      <Sidebar persona="athlete" active="Team feed" />
      <div className="content">
        <Topbar actions={<><Btn kind="primary" size="sm" icon={I.plus}>New post</Btn></>} />
        <div className="main" style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 18 }}>
          <div className="col gap-4">
            <div className="row between">
              <div className="col">
                <span className="tiny muted">Bayview United · U-17 Girls &nbsp;›&nbsp; Team feed</span>
                <h1 style={{ fontSize: 24 }}>Team feed <span className="muted" style={{ fontWeight: 400 }}>· roster-only</span></h1>
              </div>
              <div className="row gap-2">
                {["Latest", "Pinned", "Mentions", "Media"].map((l, i) => (
                  <span key={l} style={{ padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                    background: i === 0 ? "color-mix(in srgb, var(--color-brand) 12%, white)" : "var(--color-surface-card)",
                    color: i === 0 ? "var(--color-brand)" : "var(--color-text-secondary)",
                    border: "1px solid " + (i === 0 ? "color-mix(in srgb, var(--color-brand) 28%, transparent)" : "var(--color-border)"),
                  }}>{l}</span>
                ))}
              </div>
            </div>

            {/* Composer */}
            <div className="card-soft" style={{ padding: 14 }}>
              <div className="row gap-3">
                <Avatar name="Maya Castellanos" size={36} hue={270} />
                <div className="col" style={{ flex: 1, gap: 8 }}>
                  <input className="input" placeholder="Share with the team…" style={{ background: "var(--color-surface-hover)", border: "1px solid var(--color-border)" }} />
                  <div className="row gap-2 tiny muted">
                    <button className="btn ghost sm" style={{ height: 28 }}>{I.upload}Media</button>
                    <button className="btn ghost sm" style={{ height: 28 }}>📅 Tag event</button>
                    <button className="btn ghost sm" style={{ height: 28 }}>@Mention</button>
                    <div style={{ flex: 1 }} />
                    <Badge tone="slate" dot>Visible to U-17 roster only</Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Posts */}
            {[
              {
                who: "Coach Diego Park", role: "Coach", hue: 200, pinned: true,
                time: "Pinned · 2h ago",
                body: <>Pre-match brief for <Badge tone="brand">vs Riverside Strikers</Badge> is live — read it before tomorrow's walkthrough. Half-space runs are the theme. Maya, Lily — own the wide channels. 💪</>,
                attach: { kind: "event", title: "vs Riverside Strikers · Sat 11 AM", chip: "game" },
                likes: 14, comments: 6,
              },
              {
                who: "Maya Castellanos", role: "Athlete · #9", hue: 270,
                time: "Yesterday at 9:14 PM",
                body: <>Watched the Oak Valley film. The half-space pocket between their RB and CB opens for ~3 seconds after a wide switch. Going to chase it Saturday.</>,
                attach: { kind: "media", title: "Oak Valley film · 0:48 clip", desc: "Tagged by Coach Park" },
                likes: 11, comments: 4,
              },
              {
                who: "Sara Okafor", role: "Athlete · #10", hue: 300,
                time: "2 days ago",
                body: <>Captain's check: rides to the Riverside game — Lily, Jess, Emma, ride with me. Daniela &amp; Priya, coach is covering you. Reply ✅ if confirmed.</>,
                likes: 8, comments: 9,
              },
            ].map((p, i) => (
              <div key={i} className="card-soft" style={{ padding: 18, borderLeft: p.pinned ? "3px solid var(--color-brand)" : undefined }}>
                <div className="row gap-3" style={{ marginBottom: 10 }}>
                  <Avatar name={p.who} size={40} hue={p.hue} />
                  <div className="col" style={{ flex: 1 }}>
                    <div className="row gap-2"><span className="strong">{p.who}</span><Badge tone={p.role.startsWith("Coach") ? "cyan" : "slate"}>{p.role}</Badge>{p.pinned && <Badge tone="brand" dot>Pinned</Badge>}</div>
                    <span className="tiny muted">{p.time}</span>
                  </div>
                  <button className="btn ghost sm" style={{ height: 28 }}>{I.dots}</button>
                </div>
                <p className="small" style={{ marginBottom: 12, lineHeight: 1.55 }}>{p.body}</p>
                {p.attach?.kind === "event" && (
                  <div className="row gap-2" style={{ padding: 10, background: "var(--color-surface-hover)", borderRadius: 10, border: "1px solid var(--color-border)" }}>
                    <Badge tone={p.attach.chip === "game" ? "coral" : "cyan"} dot>{p.attach.chip}</Badge>
                    <span className="small strong">{p.attach.title}</span>
                    <div style={{ flex: 1 }} />
                    <Btn kind="ghost" size="sm">Open event</Btn>
                  </div>
                )}
                {p.attach?.kind === "media" && (
                  <div className="row gap-3" style={{ padding: 10, background: "var(--color-surface-hover)", borderRadius: 10, border: "1px solid var(--color-border)" }}>
                    <div className="ph" style={{ width: 88, height: 56, borderRadius: 8 }}><span>clip</span></div>
                    <div className="col" style={{ flex: 1 }}>
                      <span className="small strong">{p.attach.title}</span>
                      <span className="tiny muted">{p.attach.desc}</span>
                    </div>
                    <Btn kind="ghost" size="sm">Watch</Btn>
                  </div>
                )}
                <div className="row gap-3 tiny muted" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--color-border)" }}>
                  <span className="row gap-1">{I.heart}{p.likes}</span>
                  <span className="row gap-1">{I.comment}{p.comments}</span>
                  <span className="row gap-1">{I.share}Share</span>
                  <div style={{ flex: 1 }} />
                  <span className="row gap-1">{I.lock} Roster only</span>
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar widget */}
          <div className="col gap-4">
            <div className="card-soft" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Next up</h3>
              <EventChip type="game" title="vs Riverside Strikers" time="Sat 11 AM" team="Bayview United" />
              <div style={{ height: 8 }} />
              <EventChip type="practice" title="Walkthrough · Pitch 3" time="Fri 5:30 PM" team="Bayview United" />
            </div>
            <div className="card-soft" style={{ padding: 18 }}>
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Who's posted this week</h3>
              <div className="col gap-2">
                {[["Diego Park", 4, 200, "Coach"], ["Maya Castellanos", 2, 270, "Forward"], ["Sara Okafor", 2, 300, "Mid"], ["Lily Ahn", 1, 200, "Wing"]].map(([n, c, h, r]) => (
                  <div key={n} className="row gap-2">
                    <Avatar name={n} size={28} hue={h} />
                    <div className="col" style={{ flex: 1, minWidth: 0 }}>
                      <span className="small strong">{n}</span>
                      <span className="tiny muted">{r}</span>
                    </div>
                    <span className="tiny mono muted">{c}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card" style={{ padding: 14, background: "var(--color-surface-hover)" }}>
              <p className="tiny muted">Team feeds are visible to roster members only. Posts can't be shared cross-team.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, { CalendarMonth, EventDetail, TeamFeed });
