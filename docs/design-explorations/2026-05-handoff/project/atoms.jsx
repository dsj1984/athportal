/* Shared atoms used across all artboards.
   Exposes globals: Logo, Sidebar, Topbar, Avatar, Badge, Btn, Stat, VerifiedTick,
   PlayerCrest, FieldHeatmap, MiniSpark, EventChip, Ph, Ring */

// Brand mark — abstract geometric: a stacked chevron + dot, no clip-art sports glyphs
const Logo = ({ size = 22, label = "AthPortal" }) => (
  <div className="row gap-2" style={{ alignItems: "center" }}>
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`lg-${size}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9333ea" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <path d="M5 22 L16 6 L27 22" stroke={`url(#lg-${size})`} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="26" r="2.4" fill="#9333ea" />
    </svg>
    {label && <span className="display strong" style={{ fontSize: 15, letterSpacing: "-0.02em" }}>{label}</span>}
  </div>
);

const Avatar = ({ name = "MC", size = 32, hue = 270, src }) => {
  const initials = name.split(" ").map(s => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="avatar" style={{
      width: size, height: size, fontSize: size * 0.38,
      background: src ? `center/cover no-repeat url(${src})` :
        `linear-gradient(135deg, oklch(0.78 0.12 ${hue}) 0%, oklch(0.55 0.18 ${hue}) 100%)`,
    }}>{!src && initials}</span>
  );
};

// Verified tick used inline with text
const VerifiedTick = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-label="Verified">
    <circle cx="8" cy="8" r="8" fill="#10b981" />
    <path d="M4.5 8.3 L7 10.5 L11.5 5.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Btn = ({ kind = "primary", size, children, icon, style = {}, ...rest }) => (
  <button className={`btn ${kind}${size ? " " + size : ""}`} style={style} {...rest}>
    {icon}{children}
  </button>
);

const Badge = ({ tone = "slate", dot = false, children, style = {} }) => (
  <span className={`badge ${tone}${dot ? " dot" : ""}`} style={style}>{children}</span>
);

// ===== Icons (minimal stroke set) =====
const Icon = ({ d, size = 16, stroke = "currentColor", fill = "none", sw = 1.7, vb = "0 0 24 24" }) => (
  <svg width={size} height={size} viewBox={vb} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const I = {
  home:     <Icon d={<><path d="M3 11 L12 4 L21 11" /><path d="M5 10v10h14V10" /></>} />,
  profile:  <Icon d={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></>} />,
  team:     <Icon d={<><circle cx="9" cy="9" r="3.5" /><circle cx="17" cy="11" r="2.5" /><path d="M3 19c1-3 4-5 6-5s5 2 6 5" /><path d="M14.5 18c.8-2 3-3 4.5-3s2.5 1 3 2" /></>} />,
  calendar: <Icon d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18 M8 3v4 M16 3v4" /></>} />,
  feed:     <Icon d={<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9h10 M7 13h10 M7 17h6" /></>} />,
  trophy:   <Icon d={<><path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M5 6H3v2a3 3 0 0 0 3 3 M19 6h2v2a3 3 0 0 1-3 3" /><path d="M9 18h6 M12 13v5" /></>} />,
  chart:    <Icon d={<><path d="M4 19V5 M4 19h16" /><path d="M8 15v-4 M12 15V8 M16 15v-7" /></>} />,
  bell:     <Icon d={<><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5L6 16Z" /><path d="M10 21a2 2 0 0 0 4 0" /></>} />,
  search:   <Icon d={<><circle cx="11" cy="11" r="6" /><path d="M16 16l4 4" /></>} />,
  plus:     <Icon d={<><path d="M12 5v14 M5 12h14" /></>} />,
  check:    <Icon d={<path d="M5 12l4 4 10-10" />} />,
  arrow:    <Icon d={<path d="M5 12h14 M13 6l6 6-6 6" />} />,
  chev:     <Icon d={<path d="M9 6l6 6-6 6" />} />,
  dots:     <Icon d={<><circle cx="5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="19" cy="12" r="1.4" fill="currentColor" /></>} sw={0} />,
  settings: <Icon d={<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4.9a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.5a7 7 0 0 0-2 1.2L5.1 5.8l-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-.9a7 7 0 0 0 2 1.2L10 21h4l.5-2.5a7 7 0 0 0 2-1.2l2.4.9 2-3.5-2-1.5c.1-.4.1-.8.1-1.2Z" /></>} />,
  shield:   <Icon d={<><path d="M12 3 4 6v6c0 4.5 3 8.5 8 9 5-.5 8-4.5 8-9V6l-8-3Z" /></>} />,
  bolt:     <Icon d={<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />} />,
  pin:      <Icon d={<><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>} />,
  upload:   <Icon d={<><path d="M12 16V4 M7 9l5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>} />,
  link:     <Icon d={<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>} />,
  heart:    <Icon d={<path d="M12 20S4 14 4 9a4.5 4.5 0 0 1 8-2.9A4.5 4.5 0 0 1 20 9c0 5-8 11-8 11Z" />} />,
  comment:  <Icon d={<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-4 4v-4a2 2 0 0 1-2-2V6Z" />} />,
  share:    <Icon d={<><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 11l8-4 M8 13l8 4" /></>} />,
  lock:     <Icon d={<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>} />,
  globe:    <Icon d={<><circle cx="12" cy="12" r="9" /><path d="M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18" /></>} />,
  edit:     <Icon d={<><path d="M4 20h4l11-11-4-4L4 16v4Z" /><path d="M14 6l4 4" /></>} />,
  whistle:  <Icon d={<><circle cx="14" cy="13" r="6" /><path d="M8 13H3l2-3h3 M14 7V3l-4 2" /></>} />,
  flag:     <Icon d={<><path d="M5 21V4 M5 4h11l-2 4 2 4H5" /></>} />,
};

const NavItem = ({ icon, label, active, onClick, end }) => (
  <div className={`nav-item${active ? " active" : ""}`} onClick={onClick}>
    {icon}
    <span style={{ flex: 1 }}>{label}</span>
    {end}
  </div>
);

const Sidebar = ({ persona = "athlete", active = "Home" }) => {
  const sets = {
    athlete: [
      ["Home", I.home],
      ["My profile", I.profile],
      ["My teams", I.team],
      ["Calendar", I.calendar],
      ["Team feed", I.feed],
      ["Stats & awards", I.trophy],
    ],
    coach: [
      ["Home", I.home],
      ["Roster", I.team],
      ["Verify stats", I.shield],
      ["Calendar", I.calendar],
      ["Team feed", I.feed],
      ["Announcements", I.bell],
    ],
    org: [
      ["Overview", I.home],
      ["Teams", I.team],
      ["Coaches", I.whistle],
      ["Athletes", I.profile],
      ["Events", I.calendar],
      ["Reports", I.chart],
    ],
  };
  const items = sets[persona];
  const titles = { athlete: "Maya Castellanos", coach: "Diego Park", org: "Bayview United FC" };
  const subtitles = { athlete: "Athlete · U-17", coach: "Coach · Bayview U-17", org: "Org admin" };
  return (
    <aside className="sidebar">
      <div style={{ padding: "4px 6px 14px" }}><Logo /></div>
      {items.map(([label, icon]) => (
        <NavItem key={label} icon={icon} label={label} active={label === active} />
      ))}
      <div className="nav-section">Workspace</div>
      <NavItem icon={I.settings} label="Settings" />
      <NavItem icon={I.shield} label="Help & support" />
      <div style={{ marginTop: "auto" }} />
      <div className="row gap-2" style={{ padding: "10px 8px", borderTop: "1px solid var(--color-border)", marginTop: 8 }}>
        <Avatar name={titles[persona]} size={32} hue={persona === "coach" ? 200 : persona === "org" ? 30 : 270} />
        <div className="col" style={{ minWidth: 0, flex: 1 }}>
          <span className="small strong" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titles[persona]}</span>
          <span className="tiny muted">{subtitles[persona]}</span>
        </div>
        {I.dots}
      </div>
    </aside>
  );
};

const Topbar = ({ title, kicker, actions, search = "Search teams, athletes, events" }) => (
  <div className="topbar">
    <div className="row gap-2" style={{ width: 360 }}>
      <div className="row gap-2" style={{
        flex: 1, height: 36, padding: "0 12px", borderRadius: 10,
        background: "var(--color-surface-hover)", color: "var(--color-text-secondary)", fontSize: 13,
      }}>
        {I.search}<span>{search}</span>
        <span className="tiny" style={{ marginLeft: "auto", padding: "2px 6px", borderRadius: 6, background: "#fff", border: "1px solid var(--color-border)", color: "#64748b" }}>⌘K</span>
      </div>
    </div>
    {(title || kicker) && (
      <div className="col" style={{ marginLeft: 8 }}>
        {kicker && <span className="tiny muted">{kicker}</span>}
        {title && <span className="display strong" style={{ fontSize: 15 }}>{title}</span>}
      </div>
    )}
    <div style={{ flex: 1 }} />
    <div className="row gap-2">
      <button className="btn ghost sm" title="What's new">{I.bell}</button>
      {actions}
    </div>
  </div>
);

const Ph = ({ label, w, h, style = {}, mode = "img" }) => (
  <div className="ph" style={{ width: w, height: h, ...style }}>
    <span>{`<${label}>`}</span>
  </div>
);

// Stat tile
const Stat = ({ label, value, unit, trend, verified, hint, tone = "default" }) => (
  <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
    <div className="row between">
      <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>{label}</span>
      {verified && <VerifiedTick size={12} />}
    </div>
    <div className="row gap-1" style={{ alignItems: "baseline" }}>
      <span className="display" style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>{value}</span>
      {unit && <span className="small muted">{unit}</span>}
    </div>
    {(trend || hint) && (
      <div className="row gap-2 small">
        {trend && <span style={{ color: trend.startsWith("+") ? "#047857" : trend.startsWith("-") ? "#be123c" : "#475569", fontWeight: 600 }}>{trend}</span>}
        {hint && <span className="muted">{hint}</span>}
      </div>
    )}
  </div>
);

// Ring progress (% completion)
const Ring = ({ value = 72, size = 64, stroke = 6, label }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="col" style={{ alignItems: "center", gap: 4 }}>
      <svg width={size} height={size}>
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--color-surface-active)" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="var(--color-brand)" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - value/100)} strokeLinecap="round"
          transform={`rotate(-90 ${size/2} ${size/2})`} />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
          fontFamily="var(--font-display)" fontWeight="700" fontSize={size * 0.3} fill="var(--color-text-primary)">
          {value}%
        </text>
      </svg>
      {label && <span className="tiny muted">{label}</span>}
    </div>
  );
};

// Event chip used in calendar & lists
const EventChip = ({ type = "game", title, time, team, withRing = true, conflict }) => {
  const colors = {
    game: { bg: "rgba(244,63,94,0.15)", text: "#be123c", border: "rgba(244,63,94,0.35)" },
    practice: { bg: "rgba(14,165,233,0.15)", text: "#0369a1", border: "rgba(14,165,233,0.35)" },
    training: { bg: "rgba(16,185,129,0.16)", text: "#047857", border: "rgba(16,185,129,0.35)" },
    academic: { bg: "rgba(245,158,11,0.18)", text: "#b45309", border: "rgba(245,158,11,0.35)" },
    tournament: { bg: "rgba(147,51,234,0.14)", text: "#7c22d0", border: "rgba(147,51,234,0.35)" },
    meeting: { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" },
  };
  const c = colors[type] || colors.meeting;
  return (
    <div style={{
      padding: "6px 8px", borderRadius: 8,
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      fontSize: 11, fontWeight: 600, lineHeight: 1.3, minWidth: 0,
      boxShadow: withRing ? `inset 3px 0 0 ${c.text}` : "none",
      position: "relative",
    }}>
      {conflict && <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 999, background: "#f43f5e" }} />}
      <div className="row between"><span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 10 }}>{type}</span>{time && <span style={{ opacity: 0.75, fontWeight: 500 }}>{time}</span>}</div>
      <div style={{ fontSize: 12, marginTop: 2, color: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      {team && <div style={{ fontSize: 10, opacity: 0.7, fontWeight: 500 }}>{team}</div>}
    </div>
  );
};

// Mini-sparkline (for stat trends)
const MiniSpark = ({ points = [3, 5, 4, 7, 6, 9, 8, 11, 10, 12], color = "var(--color-brand)", w = 120, h = 36 }) => {
  const max = Math.max(...points), min = Math.min(...points);
  const dx = w / (points.length - 1);
  const pts = points.map((p, i) => `${i * dx},${h - ((p - min) / Math.max(1, max - min)) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={`color-mix(in srgb, ${color} 14%, transparent)`} stroke="none" />
    </svg>
  );
};

// Soccer field with heatmap blobs
const FieldHeatmap = ({ w = 260, h = 160 }) => (
  <svg width={w} height={h} viewBox="0 0 260 160" style={{ borderRadius: 12, overflow: "hidden" }}>
    <defs>
      <radialGradient id="hm1"><stop offset="0%" stopColor="#9333ea" stopOpacity="0.55" /><stop offset="100%" stopColor="#9333ea" stopOpacity="0" /></radialGradient>
      <radialGradient id="hm2"><stop offset="0%" stopColor="#06b6d4" stopOpacity="0.45" /><stop offset="100%" stopColor="#06b6d4" stopOpacity="0" /></radialGradient>
    </defs>
    <rect x="0" y="0" width="260" height="160" fill="#ecfeff" />
    <g stroke="#cbd5e1" strokeWidth="1" fill="none">
      <rect x="6" y="6" width="248" height="148" rx="4" />
      <line x1="130" y1="6" x2="130" y2="154" />
      <circle cx="130" cy="80" r="22" />
      <rect x="6" y="40" width="36" height="80" />
      <rect x="218" y="40" width="36" height="80" />
    </g>
    <ellipse cx="190" cy="70" rx="62" ry="42" fill="url(#hm1)" />
    <ellipse cx="160" cy="95" rx="48" ry="34" fill="url(#hm1)" />
    <ellipse cx="100" cy="80" rx="42" ry="36" fill="url(#hm2)" />
  </svg>
);

// 3-row mini bar chart for stat comparison
const MiniBars = ({ values = [0.6, 0.85, 0.45], labels = ["Pass acc.", "Shot conv.", "Duels won"], color = "var(--color-brand)" }) => (
  <div className="col gap-2">
    {values.map((v, i) => (
      <div key={i} className="col" style={{ gap: 4 }}>
        <div className="row between tiny muted"><span>{labels[i]}</span><span className="strong" style={{ color: "var(--color-text-primary)" }}>{Math.round(v * 100)}%</span></div>
        <div style={{ height: 6, background: "var(--color-surface-active)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${v * 100}%`, height: "100%", background: color, borderRadius: 4 }} />
        </div>
      </div>
    ))}
  </div>
);

Object.assign(window, {
  Logo, Avatar, VerifiedTick, Btn, Badge, Icon, I, NavItem, Sidebar, Topbar,
  Ph, Stat, Ring, EventChip, MiniSpark, FieldHeatmap, MiniBars,
});
