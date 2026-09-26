export const TOPIC_STYLES = [
  {
    id: "momentum",
    name: "Momentum-based sequencing",
    description:
      "Build curiosity slide by slide, with each idea naturally opening the question answered next.",
  },
  {
    id: "educational",
    name: "Educational / how-to",
    description:
      "Teach one practical skill through clear steps, useful context, and a concrete takeaway.",
  },
  {
    id: "market_alert",
    name: "Market alert",
    description:
      "Lead with what changed, separate evidence from inference, and end with a timely action.",
  },
  {
    id: "news_update",
    name: "News / update",
    description:
      "Explain what happened, what is confirmed, who it affects, and what remains unknown.",
  },
  {
    id: "problem_deepening",
    name: "Problem-deepening engagement",
    description:
      "Deepen recognition and emotional investment in the problem before revealing the solution.",
  },
  {
    id: "slide_one_pattern_interrupt",
    name: "Slide-one pattern interrupt",
    description:
      "Challenge a familiar belief or habit immediately so the first swipe feels irresistible.",
  },
  {
    id: "reframe_insight_reveal",
    name: "Reframe & insight reveal",
    description:
      "Earn a perspective shift that changes how the audience understands the topic.",
  },
  {
    id: "cognitive_reward",
    name: "Cognitive reward slide",
    description:
      "Deliver a memorable clarity moment that makes finishing the carousel feel worthwhile.",
  },
  {
    id: "save_share_optimization",
    name: "Save & share optimization",
    description:
      "Shape the carousel into a reference-worthy resource people want to keep and pass along.",
  },
  {
    id: "soft_cta_interaction",
    name: "Soft CTA & interaction trigger",
    description:
      "Invite reflection or personal experience so interaction feels like part of the insight.",
  },
  {
    id: "authority_without_teaching",
    name: "Authority without teaching",
    description:
      "Signal expertise through judgment, pattern recognition, and confident decision logic.",
  },
] as const;

export type TopicStyle = (typeof TOPIC_STYLES)[number];
export type TopicStyleId = TopicStyle["id"];
