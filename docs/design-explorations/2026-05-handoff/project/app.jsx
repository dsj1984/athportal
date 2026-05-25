// Main canvas — composes all screens into a Figma-ish design canvas.

const App = () => (
  <DesignCanvas>
    <DCSection id="foundations" title="Design system" subtitle="Style guide tokens, type, components — the canvas everything sits on.">
      <DCArtboard id="found" label="Foundations · tokens, type, badges" width={920} height={780}>
        <Foundations />
      </DCArtboard>
    </DCSection>

    <DCSection id="onboarding" title="Onboarding" subtitle="Server-enforced gate every authenticated user clears before /app unlocks (Epic #8).">
      <DCArtboard id="ob-1" label="Athlete · profile basics step" width={1280} height={920}>
        <Onboarding />
      </DCArtboard>
    </DCSection>

    <DCSection id="athlete" title="Athlete · the canonical persona" subtitle="13–22yo invited by their coach. Owns the profile; consumes the calendar, feed, stats.">
      <DCArtboard id="ath-home" label="Home dashboard" width={1280} height={920}>
        <AthleteHome />
      </DCArtboard>
      <DCArtboard id="ath-profile" label="Private profile · Athletic tab" width={1280} height={1100}>
        <AthleteProfileEdit />
      </DCArtboard>
      <DCArtboard id="ath-public" label="Public profile · shareable URL" width={1280} height={1240}>
        <PublicProfile />
      </DCArtboard>
    </DCSection>

    <DCSection id="coach" title="Coach · the trust chain" subtitle="Verification runs through this persona. Roster + signed stat ceremony.">
      <DCArtboard id="coach-roster" label="Roster · U-17 Girls" width={1280} height={860}>
        <CoachRoster />
      </DCArtboard>
      <DCArtboard id="coach-verify" label="Verify-stat queue + signature pane" width={1280} height={980}>
        <CoachVerify />
      </DCArtboard>
    </DCSection>

    <DCSection id="calendar" title="Calendar &amp; engagement" subtitle="Recurring touchpoints — calendar, event detail/RSVP, team feed.">
      <DCArtboard id="cal-month" label="Month view · May 2026" width={1280} height={920}>
        <CalendarMonth />
      </DCArtboard>
      <DCArtboard id="event-detail" label="Event detail · vs Riverside Strikers" width={1280} height={920}>
        <EventDetail />
      </DCArtboard>
      <DCArtboard id="team-feed" label="Team feed · roster-only" width={1280} height={1100}>
        <TeamFeed />
      </DCArtboard>
    </DCSection>

    <DCSection id="org" title="Org admin" subtitle="Club / school / collegiate department. Creates teams, invites coaches — but cannot verify stats.">
      <DCArtboard id="org-overview" label="Overview · KPIs, teams, alerts" width={1280} height={920}>
        <OrgOverview />
      </DCArtboard>
      <DCArtboard id="org-create-team" label="Create team + invite coach" width={1280} height={1080}>
        <OrgCreateTeam />
      </DCArtboard>
    </DCSection>

    <DCSection id="public" title="Public surfaces" subtitle="Anonymous + signed-out discovery. SEO-indexable per docs/web-routes.md.">
      <DCArtboard id="discovery" label="Discovery · athlete grid + filters" width={1280} height={980}>
        <Discovery />
      </DCArtboard>
    </DCSection>

    <DCSection id="mobile" title="Mobile PWA" subtitle="Mobile-first experience for athletes — Epic #19. Tab-bar shell.">
      <DCArtboard id="m-home" label="Athlete · Home" width={380} height={780}>
        <AthleteHomeMobile />
      </DCArtboard>
      <DCArtboard id="m-public" label="Public profile · mobile" width={380} height={780}>
        <PublicProfileMobile />
      </DCArtboard>
      <DCArtboard id="m-cal" label="Week + agenda" width={380} height={780}>
        <CalendarMobile />
      </DCArtboard>
      <DCArtboard id="m-verify" label="Coach · sign on sideline" width={380} height={780}>
        <VerifyMobile />
      </DCArtboard>
    </DCSection>

    <DCSection
      id="expressive"
      title="Expressive variation"
      subtitle="Style guide as a floor — same tokens, pushed harder on typography, editorial composition, and a dark dramatic public profile."
    >
      <DCArtboard id="exp-public" label="Public profile · editorial dark" width={1280} height={1240}>
        <ExpressivePublicProfile />
      </DCArtboard>
      <DCArtboard id="exp-home" label="Athlete home · magazine" width={1280} height={920}>
        <ExpressiveAthleteHome />
      </DCArtboard>
      <DCArtboard id="exp-verify" label="Verify ceremony · focused" width={780} height={760}>
        <ExpressiveVerifyCeremony />
      </DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
