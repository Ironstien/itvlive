/**
 * Dummy users for local/dev testing. Toggle via the "Test Users" button on Main Stage.
 * Each user includes profile fields and a playlist built from SAMPLE_TRACKS below.
 */

const SAMPLE_TRACKS = [
  {
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channel: 'Rick Astley',
    duration: 213,
  },
  {
    videoId: 'kJQP7kiw5Fk',
    title: 'Despacito',
    channel: 'Luis Fonsi ft. Daddy Yankee',
    duration: 282,
  },
  {
    videoId: '9bZkp7q19f0',
    title: 'Gangnam Style',
    channel: 'PSY',
    duration: 252,
  },
  {
    videoId: 'YQHsXMglC9A',
    title: 'Hello',
    channel: 'Adele',
    duration: 295,
  },
  {
    videoId: 'JGwWNGJdvx8',
    title: 'Shape of You',
    channel: 'Ed Sheeran',
    duration: 263,
  },
  {
    videoId: 'fJ9rUzIMcZQ',
    title: 'Bohemian Rhapsody',
    channel: 'Queen',
    duration: 355,
  },
  {
    videoId: 'OpQFFLBMEPI',
    title: 'All Star',
    channel: 'Smash Mouth',
    duration: 200,
  },
  {
    videoId: '060XL0PHHoo',
    title: 'Sandstorm',
    channel: 'Darude',
    duration: 225,
  },
  {
    videoId: '2vjPBr2-TJg',
    title: 'Blinding Lights',
    channel: 'The Weeknd',
    duration: 200,
  },
  {
    videoId: 'EwTZ2xpQwpA',
    title: 'Take On Me',
    channel: 'a-ha',
    duration: 244,
  },
  {
    videoId: 'hT_nvWreIhg',
    title: 'Counting Stars',
    channel: 'OneRepublic',
    duration: 257,
  },
  {
    videoId: 'RgKAFK5djSk',
    title: 'See You Again',
    channel: 'Wiz Khalifa ft. Charlie Puth',
    duration: 229,
  },
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
    playlist: pickTracks(2, 2),
  },
  {
    id: 'bass-oracle',
    displayName: 'BassOracle',
    level: 4,
    customSaying: 'Turn it up',
    badges: ['Veteran', 'Bass Head'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=BassOracle',
    playlist: pickTracks(4, 3),
  },
  {
    id: 'crystal-echo',
    displayName: 'CrystalEcho',
    level: 2,
    customSaying: 'Crystal clear beats',
    badges: [],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CrystalEcho',
    playlist: pickTracks(1, 2),
  },
  {
    id: 'static-dream',
    displayName: 'StaticDream',
    level: 1,
    customSaying: 'Just dropped in',
    badges: ['Newcomer'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=StaticDream',
    playlist: pickTracks(6, 3),
  },
  {
    id: 'purple-haze',
    displayName: 'PurpleHaze88',
    level: 3,
    customSaying: 'Purple rain incoming',
    badges: ['Collector'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=PurpleHaze88',
    playlist: pickTracks(3, 2),
  },
  {
    id: 'echo-unit',
    displayName: 'EchoUnit',
    level: 2,
    staffRole: 'mod',
    customSaying: 'Keeping the pit smooth',
    badges: ['Moderator'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=EchoUnit',
    playlist: pickTracks(5, 3),
  },
  {
    id: 'night-frequency',
    displayName: 'NightFrequency',
    level: 5,
    customSaying: 'Elite ears only',
    badges: ['Elite', 'Top Voter'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=NightFrequency',
    playlist: pickTracks(7, 2),
  },
  {
    id: 'glitch-saint',
    displayName: 'GlitchSaint',
    level: 2,
    customSaying: 'Bless this queue',
    badges: ['Glitch'],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=GlitchSaint',
    playlist: pickTracks(8, 3),
  },
  {
    id: 'zero-signal',
    displayName: 'ZeroSignal',
    level: 1,
    customSaying: 'Signal acquired',
    badges: [],
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ZeroSignal',
    playlist: pickTracks(9, 2),
  },
];

module.exports = { TEST_USERS, SAMPLE_TRACKS };
