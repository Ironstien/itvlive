/**
 * Dummy users for local/dev testing. Toggle via the "Test Users" button on Main Stage.
 * Each user includes profile fields and a playlist of 3 alternative 90s tracks.
 */

const SAMPLE_TRACKS = [
  {
    videoId: '4NRXx6U8ABQ',
    title: 'Smells Like Teen Spirit',
    channel: 'Nirvana',
    duration: 301,
  },
  {
    videoId: 'XFkzRNyygfk',
    title: 'Creep',
    channel: 'Radiohead',
    duration: 238,
  },
  {
    videoId: '3mbBbFH9fA0',
    title: 'Black Hole Sun',
    channel: 'Soundgarden',
    duration: 318,
  },
  {
    videoId: 'eBG7P-K-r1Y',
    title: 'Everlong',
    channel: 'Foo Fighters',
    duration: 250,
  },
  {
    videoId: 'bx1Bh8ZvH84',
    title: 'Wonderwall',
    channel: 'Oasis',
    duration: 258,
  },
  {
    videoId: 'WmX4OjRbphj',
    title: 'Song 2',
    channel: 'Blur',
    duration: 122,
  },
  {
    videoId: 'MS4jk87ZFOw',
    title: 'Jeremy',
    channel: 'Pearl Jam',
    duration: 319,
  },
  {
    videoId: 'qN5zw04WxKw',
    title: 'Alive',
    channel: 'Pearl Jam',
    duration: 340,
  },
  {
    videoId: 'N6o02kNavTs',
    title: 'Where Is My Mind?',
    channel: 'Pixies',
    duration: 234,
  },
  {
    videoId: 'bWXazVcflyU',
    title: 'Killing in the Name',
    channel: 'Rage Against the Machine',
    duration: 314,
  },
  {
    videoId: '3qVPNONdF58',
    title: 'No Rain',
    channel: 'Blind Melon',
    duration: 217,
  },
  {
    videoId: 'xmUZ6nMFQMU',
    title: 'Today',
    channel: 'The Smashing Pumpkins',
    duration: 213,
  },
  {
    videoId: '4aeETEoNfHg',
    title: '1979',
    channel: 'The Smashing Pumpkins',
    duration: 266,
  },
  {
    videoId: '6EjH4H0sHJc',
    title: 'Zombie',
    channel: 'The Cranberries',
    duration: 306,
  },
  {
    videoId: 'G6Kspj3OO0s',
    title: 'Linger',
    channel: 'The Cranberries',
    duration: 274,
  },
  {
    videoId: 'beINamVRGyU',
    title: 'Semi-Charmed Life',
    channel: 'Third Eye Blind',
    duration: 268,
  },
  {
    videoId: '1lyu1PZwScY',
    title: 'Bitter Sweet Symphony',
    channel: 'The Verve',
    duration: 357,
  },
  {
    videoId: 'NUTGr5t3MoY',
    title: 'Basket Case',
    channel: 'Green Day',
    duration: 181,
  },
  {
    videoId: '7iZD9g6903Y',
    title: 'Self Esteem',
    channel: 'The Offspring',
    duration: 258,
  },
  {
    videoId: '3LnzSZPGI1c',
    title: 'Under the Bridge',
    channel: 'Red Hot Chili Peppers',
    duration: 264,
  },
  {
    videoId: 'TAqZb52sgpU',
    title: 'Man in the Box',
    channel: 'Alice in Chains',
    duration: 285,
  },
  {
    videoId: 'zABLecsM5QQ',
    title: 'Rooster',
    channel: 'Alice in Chains',
    duration: 374,
  },
  {
    videoId: 'FVPvEX-PG4s',
    title: 'Plush',
    channel: 'Stone Temple Pilots',
    duration: 314,
  },
  {
    videoId: 'yjJL9DGU7Gg',
    title: 'Interstate Love Song',
    channel: 'Stone Temple Pilots',
    duration: 202,
  },
  {
    videoId: 'nOEw9iiKmxU',
    title: 'Glycerine',
    channel: 'Bush',
    duration: 266,
  },
  {
    videoId: 'xQ04WcIIfVI',
    title: 'Santa Monica',
    channel: 'Everclear',
    duration: 199,
  },
  {
    videoId: '1cQh1ccqu8M',
    title: 'One Headlight',
    channel: 'The Wallflowers',
    duration: 270,
  },
  {
    videoId: 'xGytDsqkQY8',
    title: 'Closing Time',
    channel: 'Semisonic',
    duration: 274,
  },
  {
    videoId: 'yuTMWg-OdHQ',
    title: 'Common People',
    channel: 'Pulp',
    duration: 244,
  },
  {
    videoId: '6hzrDeEaEH0',
    title: 'Lithium',
    channel: 'Nirvana',
    duration: 257,
  },
];

/** Generic chat lines about alt 90s tracks — {title} and {channel} are substituted. */
const CHAT_SNIPPETS = [
  '{title} never gets old',
  'Peak 90s alt right here',
  'This one hits different in the void',
  'Classic {channel}',
  'Who else had this on repeat in 95?',
  'The guitar on {title} is unreal',
  'Solid pick for the queue',
  'Alt rock gold',
  'This takes me straight back',
  'Turn it up — {title}',
  'Flannel era forever',
  'Remember when {channel} ruled MTV?',
  'Still the best track on the album',
  'Vinyl Pit approved',
  'This bass line though',
  'Grunge never died',
  'Perfect song for a late night session',
  '{channel} at their finest',
  'Queue just got better',
  'This is why I joined the pit',
];

/** Pick `count` tracks starting at `offset` (wraps around the sample pool). */
function pickTracks(offset, count = 3) {
  const tracks = [];
  for (let i = 0; i < count; i += 1) {
    tracks.push(SAMPLE_TRACKS[(offset + i) % SAMPLE_TRACKS.length]);
  }
  return tracks;
}

const TEST_USERS = [
  {
    id: 'neon-pulse',
    displayName: 'NeonPulse',
    level: 2,
    customSaying: 'Vibing in the void',
    badges: ['Night Owl'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NeonPulse',
    playlist: pickTracks(0, 3),
  },
  {
    id: 'void-walker',
    displayName: 'VoidWalker',
    level: 3,
    customSaying: 'Queue is life',
    badges: ['Regular'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=VoidWalker',
    playlist: pickTracks(3, 3),
  },
  {
    id: 'bass-oracle',
    displayName: 'BassOracle',
    level: 4,
    customSaying: 'Turn it up',
    badges: ['Veteran', 'Bass Head'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=BassOracle',
    playlist: pickTracks(6, 3),
  },
  {
    id: 'crystal-echo',
    displayName: 'CrystalEcho',
    level: 2,
    customSaying: 'Crystal clear beats',
    badges: [],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CrystalEcho',
    playlist: pickTracks(9, 3),
  },
  {
    id: 'static-dream',
    displayName: 'StaticDream',
    level: 1,
    customSaying: 'Just dropped in',
    badges: ['Newcomer'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=StaticDream',
    playlist: pickTracks(12, 3),
  },
  {
    id: 'purple-haze',
    displayName: 'PurpleHaze88',
    level: 3,
    customSaying: 'Purple rain incoming',
    badges: ['Collector'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=PurpleHaze88',
    playlist: pickTracks(15, 3),
  },
  {
    id: 'echo-unit',
    displayName: 'EchoUnit',
    level: 2,
    staffRole: 'mod',
    customSaying: 'Keeping the pit smooth',
    badges: ['Moderator'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=EchoUnit',
    playlist: pickTracks(18, 3),
  },
  {
    id: 'night-frequency',
    displayName: 'NightFrequency',
    level: 5,
    customSaying: 'Elite ears only',
    badges: ['Elite', 'Top Voter'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NightFrequency',
    playlist: pickTracks(21, 3),
  },
  {
    id: 'glitch-saint',
    displayName: 'GlitchSaint',
    level: 2,
    customSaying: 'Bless this queue',
    badges: ['Glitch'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=GlitchSaint',
    playlist: pickTracks(24, 3),
  },
  {
    id: 'zero-signal',
    displayName: 'ZeroSignal',
    level: 1,
    customSaying: 'Signal acquired',
    badges: [],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ZeroSignal',
    playlist: pickTracks(27, 3),
  },
  {
    id: 'amber-static',
    displayName: 'AmberStatic',
    level: 2,
    customSaying: 'Tape hiss is a feature',
    badges: ['Collector'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AmberStatic',
    playlist: pickTracks(2, 3),
  },
  {
    id: 'lofi-rebel',
    displayName: 'LoFiRebel',
    level: 3,
    customSaying: 'Distortion is love',
    badges: ['Regular'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=LoFiRebel',
    playlist: pickTracks(5, 3),
  },
  {
    id: 'grunge-pilot',
    displayName: 'GrungePilot',
    level: 4,
    customSaying: 'Seattle sound forever',
    badges: ['Veteran'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=GrungePilot',
    playlist: pickTracks(8, 3),
  },
  {
    id: 'cassette-kid',
    displayName: 'CassetteKid',
    level: 1,
    customSaying: 'Side A only',
    badges: ['Newcomer'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CassetteKid',
    playlist: pickTracks(11, 3),
  },
  {
    id: 'vinyl-shade',
    displayName: 'VinylShade',
    level: 3,
    customSaying: 'Needle down',
    badges: ['Night Owl'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=VinylShade',
    playlist: pickTracks(14, 3),
  },
  {
    id: 'drift-wave',
    displayName: 'DriftWave',
    level: 2,
    customSaying: 'Floating through tracks',
    badges: [],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DriftWave',
    playlist: pickTracks(17, 3),
  },
  {
    id: 'alt-frequency',
    displayName: 'AltFrequency',
    level: 4,
    customSaying: 'FM static dreams',
    badges: ['Elite'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=AltFrequency',
    playlist: pickTracks(20, 3),
  },
  {
    id: 'mud-honey',
    displayName: 'MudHoney',
    level: 2,
    customSaying: 'Louder than love',
    badges: ['Bass Head'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=MudHoney',
    playlist: pickTracks(23, 3),
  },
  {
    id: 'feedback-loop',
    displayName: 'FeedbackLoop',
    level: 3,
    customSaying: 'Echo chamber vibes',
    badges: ['Glitch'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=FeedbackLoop',
    playlist: pickTracks(26, 3),
  },
  {
    id: 'rain-city',
    displayName: 'RainCity',
    level: 2,
    customSaying: 'Pacific northwest mood',
    badges: ['Regular'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=RainCity',
    playlist: pickTracks(29, 3),
  },
  {
    id: 'sonic-flannel',
    displayName: 'SonicFlannel',
    level: 5,
    customSaying: 'Plaid and power chords',
    badges: ['Top Voter', 'Veteran'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=SonicFlannel',
    playlist: pickTracks(1, 3),
  },
  {
    id: 'dim-channel',
    displayName: 'DimChannel',
    level: 1,
    customSaying: 'Late night dial',
    badges: [],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DimChannel',
    playlist: pickTracks(4, 3),
  },
  {
    id: 'fuzz-cathedral',
    displayName: 'FuzzCathedral',
    level: 3,
    customSaying: 'Wall of sound',
    badges: ['Collector'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=FuzzCathedral',
    playlist: pickTracks(7, 3),
  },
  {
    id: 'tape-hiss',
    displayName: 'TapeHiss',
    level: 2,
    customSaying: 'Analog warmth only',
    badges: ['Night Owl'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=TapeHiss',
    playlist: pickTracks(10, 3),
  },
];

module.exports = { TEST_USERS, SAMPLE_TRACKS, CHAT_SNIPPETS };
