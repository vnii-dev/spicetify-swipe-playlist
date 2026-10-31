// Swipe Playlist - custom app for Spicetify
// Tabs: Add songs | By link | Liked Songs | Discover | Clean playlist | Duplicates | Tools | Diagnostics
const R = Spicetify.React;
const h = R.createElement;
// Spotify 1.3.x's CosmosAsync does NOT throw: it returns {code, error, message, stack}.
// Here we turn that into a real error and first try the client's own token.
const rawCosmos = Spicetify.CosmosAsync;
const isErrPayload = (r) => r && typeof r === "object" && !Array.isArray(r) && "error" in r && "code" in r;

async function getToken() {
  const P = Spicetify.Platform || {};
  const tries = [
    () => P.AuthorizationAPI?.getState?.()?.token?.accessToken,
    async () => (await P.AuthorizationAPI?._tokenProvider?.())?.accessToken,
    () => P.Session?.accessToken,
    () => Spicetify.Session?.accessToken,
  ];
  for (const f of tries) {
    try {
      const t = await f();
      if (typeof t === "string" && t.length > 20) return t;
    } catch (e) {}
  }
  throw new Error(tx("could not find the client token"));
}

let lastWeb = 0;
let webBlockedUntil = 0;
function rateErr(sec) {
  const e = new Error(tx("429 Spotify rate limit (wait ~{0}s)", [sec]));
  e.status = 429;
  e.retryAfter = sec;
  return e;
}
// spaces out the calls and does not hit the API while Spotify asked us to wait
async function webGate() {
  const now = Date.now();
  if (now < webBlockedUntil) throw rateErr(Math.ceil((webBlockedUntil - now) / 1000));
  const wait = lastWeb + 300 - now;
  if (wait > 0) await sleep(wait);
  lastWeb = Date.now();
}

async function tokenFetch(method, url, body) {
  await webGate();
  const token = await getToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 429) {
    const sec = Math.max(1, parseInt(res.headers?.get?.("Retry-After") || "30", 10) || 30);
    webBlockedUntil = Date.now() + sec * 1000;
    throw rateErr(sec);
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {}
  if (!res.ok) {
    throw new Error(`${res.status} ${data?.error?.message || data?.message || res.statusText || ""}`.trim());
  }
  return data ?? {};
}

async function viaWeb(method, url, body) {
  const errs = [];
  let limited = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await tokenFetch(method, url, body);
    } catch (e) {
      errs[0] = `token: ${e?.message || e}`;
      if (e?.status === 429) {
        limited = true;
        // short wait: wait and try once more
        if (e.retryAfter && e.retryAfter <= 8 && attempt === 0) {
          await sleep(e.retryAfter * 1000 + 200);
          webBlockedUntil = 0;
          limited = false;
          continue;
        }
      }
      break;
    }
  }
  if (!limited) {
    try {
      const fn = method === "GET" ? "get" : method === "POST" ? "post" : "del";
      const r = await rawCosmos[fn](url, body);
      if (isErrPayload(r)) throw new Error(`${r.code} ${r.error} ${r.message || ""}`.trim());
      return r;
    } catch (e) {
      errs.push(`cosmos: ${e?.message || e}`);
    }
  }
  throw new Error(errs.join(" | "));
}

const C = {
  get: (u) => viaWeb("GET", u),
  post: (u, b) => viaWeb("POST", u, b),
  del: (u, b) => viaWeb("DELETE", u, b),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let STOP = false; // Cancel button for long searches
const API = "https://api.spotify.com/v1";
const SAVE_KEY = "swipePlaylist:session";

// ---------- languages ----------
// English is the base language: the English text is the key. To add a language, add a block to I18N
// (key = the English text, value = your translation; keep the {0}, {1} placeholders) and list it in LANGS.
const LANGS = { en: "English", "pt-BR": "Português (Brasil)", es: "Español" };
const LANG_KEY = "swipePlaylist:lang";
let CUR_LANG = "en";
const I18N = {
  "pt-BR": {
      "could not find the client token": "não achei o token do cliente",
      "429 Spotify rate limit (wait ~{0}s)": "429 limite de requisições do Spotify (aguarde ~{0}s)",
      "GraphQL unavailable": "GraphQL indisponível",
      "Spotify has no internal search definition (GraphQL)": "o Spotify não tem definição de busca interna (GraphQL)",
      "{0}: results unrelated to the search": "{0}: resultados sem relação com a busca",
      "no internal search definition worked [{0}]": "nenhuma definição de busca interna funcionou [{0}]",
      "response without results": "resposta sem resultados",
      "internal search: {0}": "busca interna: {0}",
      "internal library came back empty": "biblioteca interna veio vazia",
      "internal library: {0}": "biblioteca interna: {0}",
      "web API came back empty": "API web veio vazia",
      "web API: {0}": "API web: {0}",
      "status {0}": "status {0}",
      "PlaylistAPI.getContents does not exist in this version": "PlaylistAPI.getContents não existe nesta versão",
      "unexpected format (no item list)": "formato inesperado (sem lista de itens)",
      "items without a uri (unknown format)": "itens sem uri (formato desconhecido)",
      "internal: {0}": "interna: {0}",
      "the internal API accepted it, but the song did not show up in the playlist": "a API interna aceitou, mas a música não apareceu na playlist",
      "internal: PlaylistAPI.add does not exist in this version": "interna: PlaylistAPI.add não existe nesta versão",
      "PlaylistAPI.remove does not exist in this version": "PlaylistAPI.remove não existe nesta versão",
      "could not find the song in the playlist to remove it": "não achei a música na playlist para remover",
      "the internal API accepted it, but the song is still in the playlist": "a API interna aceitou, mas a música continua na playlist",
      "LibraryAPI.getTracks does not exist in this version": "LibraryAPI.getTracks não existe nesta versão",
      "no playlist data": "sem dados da playlist",
      "(does not exist)": "(não existe)",
      "(no methods)": "(nenhum método)",
      "GraphQL (search definitions): {0}": "GraphQL (definições de busca): {0}",
      "Web API limit: {0}": "Limite da API web: {0}",
      "read playlist (internal)": "ler playlist (interna)",
      "{0} items": "{0} itens",
      "client token": "token do cliente",
      "ok ({0} characters)": "ok ({0} caracteres)",
      "web via token (search)": "web via token (busca)",
      "{0} result(s)": "{0} resultado(s)",
      "internal search (GraphQL)": "busca interna (GraphQL)",
      "{0} result(s), 1st: {1}": "{0} resultado(s), 1º: {1}",
      "search (path the app uses)": "busca (caminho que o app usa)",
      "playlist bio": "bio da playlist",
      "{0} song(s) read": "{0} música(s) lida(s)",
      "(this test only reads; it does not add or remove anything)": "(este teste só lê; não adiciona nem remove nada)",
      "The test songs are already in this playlist; pick another playlist.": "As músicas de teste já estão nessa playlist; escolha outra playlist.",
      "Write test with {0} (the playlist has {1} items)": "Teste de escrita com {0} (a playlist tem {1} itens)",
      "✅ add: worked ({0})": "✅ adicionar: funcionou ({0})",
      "❌ add: the song did not show up in the playlist": "❌ adicionar: a música não apareceu na playlist",
      "❌ add: {0}": "❌ adicionar: {0}",
      "❌ remove: the song is still in the playlist (remove it manually)": "❌ remover: a música continua na playlist (tire manualmente)",
      "✅ remove: worked": "✅ remover: funcionou",
      "❌ remove: {0} (remove the test song manually)": "❌ remover: {0} (tire a música de teste manualmente)",
      "Copied!": "Copiado!",
      "Loading liked songs... {0}": "Carregando curtidas... {0}",
      "Reading {0}/{1}: {2}": "Lendo {0}/{1}: {2}",
      "No playlist found.": "Nenhuma playlist encontrada.",
      "Invalid playlist link": "Link de playlist inválido",
      "Already in the playlist: {0}": "Já está na playlist: {0}",
      "⚠ \"{0}\" already appeared earlier in this list, so I skipped it.": "⚠ \"{0}\" já apareceu antes nesta lista, então pulei.",
      "Could not read a playlist; duplicates won't be checked for it": "Não consegui ler uma playlist; duplicadas não serão checadas nela",
      "Reading the playlist...": "Lendo a playlist...",
      "No songs found in that playlist": "Nenhuma música encontrada nessa playlist",
      "Could not read that playlist (it must be public)": "Não consegui ler essa playlist (ela precisa ser pública)",
      "Loading liked songs...": "Carregando curtidas...",
      "No liked songs found": "Nenhuma música curtida encontrada",
      "Error loading liked songs": "Erro ao carregar as curtidas",
      "That playlist is empty": "Essa playlist está vazia",
      "Error reading the playlist": "Erro ao ler a playlist",
      "Testing writing...": "Testando escrita...",
      "Error in the write test": "Erro no teste de escrita",
      "Testing...": "Testando...",
      "Error in the diagnostics": "Erro no diagnóstico",
      "Reading the bio...": "Lendo a bio...",
      "Could not read the playlist bio": "Não consegui ler a bio da playlist",
      "Searching \"{0}\" ({1}/{2}) — {3} new so far": "Buscando \"{0}\" ({1}/{2}) — {3} novas até agora",
      "Reading the playlist's artists...": "Lendo os artistas da playlist...",
      "More from {0}...": "Mais de {0}...",
      "Search cancelled": "Busca cancelada",
      "No new songs found for those terms": "Não achei músicas novas com esses termos",
      "Spotify didn't allow reading other people's playlists; I only used the song search": "O Spotify não deixou ler playlists de outras pessoas; usei só a busca de músicas",
      "Search error": "Erro na busca",
      "Resuming...": "Retomando...",
      "Error adding to the playlist": "Erro ao adicionar na playlist",
      "Error removing from the playlist": "Erro ao remover da playlist",
      "Error moving the song": "Erro ao mover a música",
      "Error undoing": "Erro ao desfazer",
      "Error searching for duplicates": "Erro ao procurar duplicadas",
      "Removing...": "Removendo...",
      "Removing in {0}...": "Removendo em {0}...",
      "🗑 {0} duplicate(s) removed. One of each is left in every playlist.": "🗑 {0} repetida(s) removida(s). Ficou 1 de cada em cada playlist.",
      "🗑 {0} copy(ies) removed. Only 1 of each song is left.": "🗑 {0} cópia(s) removida(s). Ficou só 1 de cada música.",
      "Error removing duplicates": "Erro ao remover duplicadas",
      "Duplicate removed": "Repetida removida",
      "Removed from {0}": "Removida de {0}",
      "Error removing": "Erro ao remover",
      "Error exporting the playlist": "Erro ao exportar a playlist",
      "Checking the playlist...": "Verificando a playlist...",
      "Error checking the playlist": "Erro ao verificar a playlist",
      "{0} removed": "{0} removida(s)",
      "Could not read the file": "Não consegui ler o arquivo",
      "Maybe (already there)": "Talvez (já tem)",
      "Maybe ({0})": "Talvez ({0})",
      "Move to {0}": "Mover para {0}",
      "Remove from playlist": "Remover da playlist",
      "Keep": "Manter",
      "Skip": "Pular",
      "Add anyway": "Adicionar mesmo assim",
      "Add": "Adicionar",
      "{0} (already there)": "{0} (já tem)",
      "\"{0}\" is already in {1}. Add it anyway? It will be duplicated.": "\"{0}\" já está em {1}. Quer adicionar mesmo assim? Ela vai ficar duplicada.",
      "Yes, add again": "Sim, adicionar de novo",
      "No, go back": "Não, voltar",
      "Cleaning: {0}": "Limpando: {0}",
      "→ choose the playlist": "→ escolha a playlist",
      "⚠ The search failed: {0}": "⚠ A busca falhou: {0}",
      "Try again": "Tentar de novo",
      "Skip this song": "Pular esta música",
      "Searching...": "Buscando...",
      "⚠ This song is already in: {0}.": "⚠ Essa música já está em: {0}.",
      "↩ Undo": "↩ Desfazer",
      "Stop and save": "Parar e salvar",
      "Done!": "Pronto!",
      "🗑 Removed: {0}": "🗑 Removidas: {0}",
      "✅ Kept: {0}": "✅ Mantidas: {0}",
      "➜ Moved: {0}": "➜ Movidas: {0}",
      "✅ Added: {0}": "✅ Adicionadas: {0}",
      "❔ In Maybe: {0}": "❔ Em Talvez: {0}",
      "✕ Skipped: {0}": "✕ Puladas: {0}",
      "🔁 Repeated in the list (skipped): {0}": "🔁 Repetidas na lista (puladas): {0}",
      "❓ Not found: {0}": "❓ Não encontradas: {0}",
      "↩ Undo last": "↩ Desfazer última",
      "Back to start": "Voltar ao início",
      "Add songs": "Adicionar músicas",
      "By link": "Por link",
      "Liked Songs": "Curtidas",
      "Discover": "Descobrir",
      "Clean playlist": "Limpar playlist",
      "Duplicates": "Duplicadas",
      "Tools": "Ferramentas",
      "Diagnostics": "Diagnóstico",
      "Session in progress ({0}): {1}/{2}": "Sessão em andamento ({0}): {1}/{2}",
      "Continue where I left off": "Continuar de onde parou",
      "Discard": "Descartar",
      "Playlist for the \"Maybe\" button (optional):": "Playlist do botão \"Talvez\" (opcional):",
      "No Maybe button": "Sem botão Talvez",
      "Loading...": "Carregando...",
      "Paste the songs (one per line or separated by ;). E.g.: Blinding Lights - The Weeknd": "Cole as músicas (uma por linha ou separadas por ;). Ex.: Blinding Lights - The Weeknd",
      "Or load a .txt or .csv file:": "Ou carregue um arquivo .txt ou .csv:",
      "Destination playlist(s) (check one or more):": "Playlist(s) de destino (marque uma ou mais):",
      "Start": "Começar",
      "Paste the link of a public playlist (yours or someone else's) and send the good songs to yours.": "Cole o link de uma playlist pública (sua ou de outra pessoa) e mande as boas para as suas.",
      "Load playlist and start": "Carregar playlist e começar",
      "Go through your Liked Songs (most recent first) and send each one to the right playlist.": "Passe pelas suas Músicas Curtidas (as mais recentes primeiro) e mande cada uma para a playlist certa.",
      "How many songs to load (0 = all):": "Quantas músicas carregar (0 = todas):",
      "Load liked songs and start": "Carregar curtidas e começar",
      "Listen to the songs already in a playlist: ✓ keeps, ✕ removes and ➜ moves to another playlist.": "Ouça as músicas que já estão numa playlist: ✓ mantém, ✕ remove e ➜ move para outra playlist.",
      "Playlist to clean:": "Playlist para limpar:",
      "Playlist for the \"Move\" button (optional):": "Playlist do botão \"Mover\" (opcional):",
      "No Move button": "Sem botão Mover",
      "Start cleaning": "Começar a limpar",
      "Reads the playlist's name and description (bio), searches for songs with those terms and you approve them one by one. Approved ones go to that same playlist.": "Lê o nome e a descrição (bio) da playlist, procura músicas com esses termos e você aprova uma por uma. As aprovadas vão para essa mesma playlist.",
      "Read the playlist bio": "Ler a bio da playlist",
      "(the playlist has no description)": "(a playlist não tem descrição)",
      "Search terms (one per line, edit freely):": "Termos de busca (um por linha, edite à vontade):",
      "E.g.: 80s rock\nworkout songs": "Ex.: rock dos anos 80\nmúsicas para treinar",
      "How many new songs do you want to see?": "Quantas músicas novas você quer ver?",
      "Search songs with these terms": "Buscar músicas com esses termos",
      "Also search similar public playlists": "Buscar também em playlists públicas parecidas",
      "Include more songs from the artists already in the playlist": "Incluir mais músicas dos artistas que já estão na playlist",
      "Search and start": "Buscar e começar",
      "Tests what works on your Spotify. If something fails, copy the result and send it with your bug report.": "Testa o que funciona no seu Spotify. Se algo falhar, copie o resultado e me mande.",
      "Playlist to test:": "Playlist para testar:",
      "Run diagnostics": "Rodar diagnóstico",
      "Test writing (adds 1 test song and removes it right after)": "Testar escrita (adiciona 1 música de teste e remove em seguida)",
      "Copy result": "Copiar resultado",
      "Search this playlist": "Procurar nesta playlist",
      "all playlists": "todas as playlists",
      "Search all playlists": "Procurar em todas as playlists",
      "Scanning...": "Procurando...",
      "{0} duplicate(s) in {1}": "{0} duplicada(s) em {1}",
      "Confirm: remove {0} duplicate(s)": "Confirmar: remover {0} repetida(s)",
      "Remove all duplicates (keeps 1 of each)": "Remover todas as repetidas (mantém 1 de cada)",
      "Remove duplicates within each playlist": "Remover as repetidas dentro de cada playlist",
      "Confirm: remove {0} copy(ies) and keep only 1 of each song": "Confirmar: remover {0} cópia(s) e deixar só 1 de cada música",
      "Remove all (keeps only 1 copy of each song)": "Remover todas (mantém só 1 cópia de cada música)",
      "Remove duplicate": "Remover repetida",
      "Take out of here": "Tirar daqui",
      "No duplicate songs 🎉": "Nenhuma música duplicada 🎉",
      "{0} song(s). Copy or download (format Song - Artist):": "{0} música(s). Copie ou baixe (formato Música - Autor):",
      "Copy": "Copiar",
      "Download .txt": "Baixar .txt",
      "{0} unavailable": "{0} indisponível(is)",
      "There are also {0} item(s) deleted from Spotify that the API won't let me remove; remove them in the app.": "Também há {0} item(ns) apagado(s) do Spotify que a API não deixa remover; tire pelo app.",
      "Confirm: remove {0}": "Confirmar: remover {0}",
      "Remove all unavailable songs": "Remover todas as indisponíveis",
      "No unavailable songs 🎉": "Nenhuma música indisponível 🎉",
      "Remove": "Remover",
      "Export to text": "Exportar para texto",
      "Find unavailable songs": "Procurar indisponíveis",
      "Loading your playlists...": "Carregando suas playlists...",
      "⚠ Could not load your playlists. {0}": "⚠ Não consegui carregar suas playlists. {0}",
      "Or add a playlist by link:": "Ou adicione uma playlist pelo link:",
      "Add by link": "Adicionar por link",
      "Working...": "Trabalhando...",
      "Cancel": "Cancelar",
      "no results": "sem resultados",
      "(none)": "(nenhuma)",
      "blocked for ~{0}s more (Spotify asked to wait)": "bloqueada por mais ~{0}s (o Spotify mandou esperar)",
      "not blocked right now": "sem bloqueio no momento",
      "no id": "sem id",
      "(no description)": "(sem descrição)",
      "via the web API": "pela API web",
      "via the internal API": "pela API interna",
      "Language:": "Idioma:",
      "Automatic (system / Spotify)": "Automático (sistema / Spotify)",
      "add": "adicionar",
      "liked songs": "curtidas",
      "clean playlist": "limpar playlist",
      "New playlist name": "Nome da nova playlist",
      "＋ Create": "＋ Criar",
      "Creating the playlist...": "Criando a playlist...",
      "Playlist created: {0}": "Playlist criada: {0}",
      "Could not create the playlist": "Não consegui criar a playlist",
      "Send the approved songs to another playlist": "Mandar as aprovadas para outra playlist",
      "Sort a playlist into a new playlist": "Ordenar uma playlist em uma nova playlist",
      "The original playlist is not changed; a sorted copy is created.": "A playlist original não é alterada; uma cópia ordenada é criada.",
      "Title (A–Z)": "Título (A–Z)",
      "Artist (A–Z)": "Artista (A–Z)",
      "Album (A–Z)": "Álbum (A–Z)",
      "Date added (newest first)": "Data de adição (mais recentes primeiro)",
      "Date added (oldest first)": "Data de adição (mais antigas primeiro)",
      "Random": "Aleatório",
      "Name of the sorted playlist": "Nome da playlist ordenada",
      "Create sorted copy": "Criar cópia ordenada",
      "{0} (sorted)": "{0} (ordenada)",
      "Adding songs {0}/{1}...": "Adicionando músicas {0}/{1}...",
      "✅ Created \"{0}\" with {1} songs.": "✅ Playlist \"{0}\" criada com {1} músicas.",
      "Error sorting the playlist": "Erro ao ordenar a playlist",
      "Where is this song?": "Onde está essa música?",
      "Type part of the title or artist": "Digite parte do título ou do artista",
      "Search all my playlists": "Procurar em todas as minhas playlists",
      "Looking in {0}/{1}: {2}": "Procurando em {0}/{1}: {2}",
      "{0} song(s) found": "{0} música(s) encontrada(s)",
      "No song found with that text": "Nenhuma música encontrada com esse texto",
      "Error searching your playlists": "Erro ao procurar nas suas playlists",
      "Backup and restore": "Backup e restauração",
      "Back up all my playlists": "Fazer backup de todas as minhas playlists",
      "Backup ready: {0} playlist(s), {1} song(s), about {2} KB.": "Backup pronto: {0} playlist(s), {1} música(s), cerca de {2} KB.",
      "Copy backup": "Copiar backup",
      "Download .json": "Baixar .json",
      "Restore from a backup file (.json):": "Restaurar de um arquivo de backup (.json):",
      "The file is not a valid backup": "O arquivo não é um backup válido",
      "Playlists in the backup (restored as new playlists):": "Playlists no backup (serão restauradas como novas playlists):",
      "{0} ({1} songs)": "{0} ({1} músicas)",
      "Restore selected": "Restaurar as selecionadas",
      "Restoring {0}/{1}: {2}": "Restaurando {0}/{1}: {2}",
      "✅ Restored {0} playlist(s).": "✅ {0} playlist(s) restaurada(s).",
      "{0} (restored)": "{0} (restaurada)",
      "Error in the backup": "Erro no backup",
      "Error restoring": "Erro ao restaurar",
      "Show a Queue button": "Mostrar um botão Fila",
      "Add to queue": "Adicionar à fila",
      "Added to the queue": "Adicionada à fila",
      "Error adding to the queue": "Erro ao adicionar à fila",
      "🎶 Queued: {0}": "🎶 Na fila: {0}"
  },
  es: {
      "Copied!": "¡Copiado!",
      "Loading liked songs... {0}": "Cargando canciones que te gustan... {0}",
      "Reading {0}/{1}: {2}": "Leyendo {0}/{1}: {2}",
      "No playlist found.": "No se encontró ninguna playlist.",
      "Invalid playlist link": "Enlace de playlist no válido",
      "Already in the playlist: {0}": "Ya está en la playlist: {0}",
      "⚠ \"{0}\" already appeared earlier in this list, so I skipped it.": "⚠ \"{0}\" ya apareció antes en esta lista, así que la omití.",
      "Could not read a playlist; duplicates won't be checked for it": "No pude leer una playlist; no se comprobarán duplicadas en ella",
      "Reading the playlist...": "Leyendo la playlist...",
      "No songs found in that playlist": "No se encontraron canciones en esa playlist",
      "Could not read that playlist (it must be public)": "No pude leer esa playlist (debe ser pública)",
      "Loading liked songs...": "Cargando canciones que te gustan...",
      "No liked songs found": "No se encontraron canciones que te gusten",
      "Error loading liked songs": "Error al cargar las canciones que te gustan",
      "That playlist is empty": "Esa playlist está vacía",
      "Error reading the playlist": "Error al leer la playlist",
      "Testing writing...": "Probando la escritura...",
      "Error in the write test": "Error en la prueba de escritura",
      "Testing...": "Probando...",
      "Error in the diagnostics": "Error en el diagnóstico",
      "Reading the bio...": "Leyendo la bio...",
      "Could not read the playlist bio": "No pude leer la bio de la playlist",
      "Searching \"{0}\" ({1}/{2}) — {3} new so far": "Buscando \"{0}\" ({1}/{2}) — {3} nuevas hasta ahora",
      "Reading the playlist's artists...": "Leyendo los artistas de la playlist...",
      "More from {0}...": "Más de {0}...",
      "Search cancelled": "Búsqueda cancelada",
      "No new songs found for those terms": "No encontré canciones nuevas con esos términos",
      "Spotify didn't allow reading other people's playlists; I only used the song search": "Spotify no permitió leer playlists de otras personas; solo usé la búsqueda de canciones",
      "Search error": "Error en la búsqueda",
      "Resuming...": "Retomando...",
      "Error adding to the playlist": "Error al añadir a la playlist",
      "Error removing from the playlist": "Error al quitar de la playlist",
      "Error moving the song": "Error al mover la canción",
      "Error undoing": "Error al deshacer",
      "Error searching for duplicates": "Error al buscar duplicadas",
      "Removing...": "Quitando...",
      "Removing in {0}...": "Quitando en {0}...",
      "🗑 {0} duplicate(s) removed. One of each is left in every playlist.": "🗑 {0} duplicada(s) quitada(s). Queda 1 de cada una en cada playlist.",
      "🗑 {0} copy(ies) removed. Only 1 of each song is left.": "🗑 {0} copia(s) quitada(s). Queda solo 1 de cada canción.",
      "Error removing duplicates": "Error al quitar duplicadas",
      "Duplicate removed": "Duplicada quitada",
      "Removed from {0}": "Quitada de {0}",
      "Error removing": "Error al quitar",
      "Error exporting the playlist": "Error al exportar la playlist",
      "Checking the playlist...": "Comprobando la playlist...",
      "Error checking the playlist": "Error al comprobar la playlist",
      "{0} removed": "{0} quitada(s)",
      "Could not read the file": "No pude leer el archivo",
      "Maybe (already there)": "Quizás (ya está)",
      "Maybe ({0})": "Quizás ({0})",
      "Move to {0}": "Mover a {0}",
      "Remove from playlist": "Quitar de la playlist",
      "Keep": "Mantener",
      "Skip": "Omitir",
      "Add anyway": "Añadir igualmente",
      "Add": "Añadir",
      "{0} (already there)": "{0} (ya está)",
      "\"{0}\" is already in {1}. Add it anyway? It will be duplicated.": "\"{0}\" ya está en {1}. ¿Añadirla igualmente? Quedará duplicada.",
      "Yes, add again": "Sí, añadir otra vez",
      "No, go back": "No, volver",
      "Cleaning: {0}": "Limpiando: {0}",
      "→ choose the playlist": "→ elige la playlist",
      "⚠ The search failed: {0}": "⚠ La búsqueda falló: {0}",
      "Try again": "Intentar de nuevo",
      "Skip this song": "Omitir esta canción",
      "Searching...": "Buscando...",
      "⚠ This song is already in: {0}.": "⚠ Esta canción ya está en: {0}.",
      "↩ Undo": "↩ Deshacer",
      "Stop and save": "Parar y guardar",
      "Done!": "¡Listo!",
      "🗑 Removed: {0}": "🗑 Quitadas: {0}",
      "✅ Kept: {0}": "✅ Mantenidas: {0}",
      "➜ Moved: {0}": "➜ Movidas: {0}",
      "✅ Added: {0}": "✅ Añadidas: {0}",
      "❔ In Maybe: {0}": "❔ En Quizás: {0}",
      "✕ Skipped: {0}": "✕ Omitidas: {0}",
      "🔁 Repeated in the list (skipped): {0}": "🔁 Repetidas en la lista (omitidas): {0}",
      "❓ Not found: {0}": "❓ No encontradas: {0}",
      "↩ Undo last": "↩ Deshacer la última",
      "Back to start": "Volver al inicio",
      "Add songs": "Añadir canciones",
      "By link": "Por enlace",
      "Liked Songs": "Me gusta",
      "Discover": "Descubrir",
      "Clean playlist": "Limpiar playlist",
      "Duplicates": "Duplicadas",
      "Tools": "Herramientas",
      "Diagnostics": "Diagnóstico",
      "Session in progress ({0}): {1}/{2}": "Sesión en curso ({0}): {1}/{2}",
      "Continue where I left off": "Continuar donde lo dejé",
      "Discard": "Descartar",
      "Playlist for the \"Maybe\" button (optional):": "Playlist del botón \"Quizás\" (opcional):",
      "No Maybe button": "Sin botón Quizás",
      "Loading...": "Cargando...",
      "Paste the songs (one per line or separated by ;). E.g.: Blinding Lights - The Weeknd": "Pega las canciones (una por línea o separadas por ;). Ej.: Blinding Lights - The Weeknd",
      "Or load a .txt or .csv file:": "O carga un archivo .txt o .csv:",
      "Destination playlist(s) (check one or more):": "Playlist(s) de destino (marca una o más):",
      "Start": "Empezar",
      "Paste the link of a public playlist (yours or someone else's) and send the good songs to yours.": "Pega el enlace de una playlist pública (tuya o de otra persona) y manda las buenas a las tuyas.",
      "Load playlist and start": "Cargar playlist y empezar",
      "Go through your Liked Songs (most recent first) and send each one to the right playlist.": "Recorre tus canciones que te gustan (las más recientes primero) y manda cada una a la playlist correcta.",
      "How many songs to load (0 = all):": "Cuántas canciones cargar (0 = todas):",
      "Load liked songs and start": "Cargar canciones que te gustan y empezar",
      "Listen to the songs already in a playlist: ✓ keeps, ✕ removes and ➜ moves to another playlist.": "Escucha las canciones que ya están en una playlist: ✓ mantiene, ✕ quita y ➜ mueve a otra playlist.",
      "Playlist to clean:": "Playlist para limpiar:",
      "Playlist for the \"Move\" button (optional):": "Playlist del botón \"Mover\" (opcional):",
      "No Move button": "Sin botón Mover",
      "Start cleaning": "Empezar a limpiar",
      "Reads the playlist's name and description (bio), searches for songs with those terms and you approve them one by one. Approved ones go to that same playlist.": "Lee el nombre y la descripción (bio) de la playlist, busca canciones con esos términos y tú las apruebas una por una. Las aprobadas van a esa misma playlist.",
      "Read the playlist bio": "Leer la bio de la playlist",
      "(the playlist has no description)": "(la playlist no tiene descripción)",
      "Search terms (one per line, edit freely):": "Términos de búsqueda (uno por línea, edita a tu gusto):",
      "E.g.: 80s rock\nworkout songs": "Ej.: rock de los 80\ncanciones para entrenar",
      "How many new songs do you want to see?": "¿Cuántas canciones nuevas quieres ver?",
      "Search songs with these terms": "Buscar canciones con estos términos",
      "Also search similar public playlists": "Buscar también en playlists públicas parecidas",
      "Include more songs from the artists already in the playlist": "Incluir más canciones de los artistas que ya están en la playlist",
      "Search and start": "Buscar y empezar",
      "Tests what works on your Spotify. If something fails, copy the result and send it with your bug report.": "Prueba qué funciona en tu Spotify. Si algo falla, copia el resultado y envíalo con tu reporte de error.",
      "Playlist to test:": "Playlist para probar:",
      "Run diagnostics": "Ejecutar diagnóstico",
      "Test writing (adds 1 test song and removes it right after)": "Probar escritura (añade 1 canción de prueba y la quita enseguida)",
      "Copy result": "Copiar resultado",
      "Search this playlist": "Buscar en esta playlist",
      "all playlists": "todas las playlists",
      "Search all playlists": "Buscar en todas las playlists",
      "Scanning...": "Analizando...",
      "{0} duplicate(s) in {1}": "{0} duplicada(s) en {1}",
      "Confirm: remove {0} duplicate(s)": "Confirmar: quitar {0} duplicada(s)",
      "Remove all duplicates (keeps 1 of each)": "Quitar todas las duplicadas (deja 1 de cada una)",
      "Remove duplicates within each playlist": "Quitar las duplicadas dentro de cada playlist",
      "Confirm: remove {0} copy(ies) and keep only 1 of each song": "Confirmar: quitar {0} copia(s) y dejar solo 1 de cada canción",
      "Remove all (keeps only 1 copy of each song)": "Quitar todas (deja solo 1 copia de cada canción)",
      "Remove duplicate": "Quitar duplicada",
      "Take out of here": "Quitar de aquí",
      "No duplicate songs 🎉": "Ninguna canción duplicada 🎉",
      "{0} song(s). Copy or download (format Song - Artist):": "{0} canción(es). Copia o descarga (formato Canción - Artista):",
      "Copy": "Copiar",
      "Download .txt": "Descargar .txt",
      "{0} unavailable": "{0} no disponible(s)",
      "There are also {0} item(s) deleted from Spotify that the API won't let me remove; remove them in the app.": "También hay {0} elemento(s) borrado(s) de Spotify que la API no deja quitar; quítalos desde la app.",
      "Confirm: remove {0}": "Confirmar: quitar {0}",
      "Remove all unavailable songs": "Quitar todas las no disponibles",
      "No unavailable songs 🎉": "Ninguna canción no disponible 🎉",
      "Remove": "Quitar",
      "Export to text": "Exportar a texto",
      "Find unavailable songs": "Buscar no disponibles",
      "Loading your playlists...": "Cargando tus playlists...",
      "⚠ Could not load your playlists. {0}": "⚠ No pude cargar tus playlists. {0}",
      "Or add a playlist by link:": "O añade una playlist por enlace:",
      "Add by link": "Añadir por enlace",
      "Working...": "Trabajando...",
      "Cancel": "Cancelar",
      "Language:": "Idioma:",
      "Automatic (system / Spotify)": "Automático (sistema / Spotify)",
      "add": "añadir",
      "liked songs": "me gusta",
      "clean playlist": "limpiar playlist",
      "New playlist name": "Nombre de la nueva playlist",
      "＋ Create": "＋ Crear",
      "Creating the playlist...": "Creando la playlist...",
      "Playlist created: {0}": "Playlist creada: {0}",
      "Could not create the playlist": "No pude crear la playlist",
      "Send the approved songs to another playlist": "Enviar las aprobadas a otra playlist",
      "Sort a playlist into a new playlist": "Ordenar una playlist en una nueva playlist",
      "The original playlist is not changed; a sorted copy is created.": "La playlist original no se modifica; se crea una copia ordenada.",
      "Title (A–Z)": "Título (A–Z)",
      "Artist (A–Z)": "Artista (A–Z)",
      "Album (A–Z)": "Álbum (A–Z)",
      "Date added (newest first)": "Fecha de adición (más recientes primero)",
      "Date added (oldest first)": "Fecha de adición (más antiguas primero)",
      "Random": "Aleatorio",
      "Name of the sorted playlist": "Nombre de la playlist ordenada",
      "Create sorted copy": "Crear copia ordenada",
      "{0} (sorted)": "{0} (ordenada)",
      "Adding songs {0}/{1}...": "Añadiendo canciones {0}/{1}...",
      "✅ Created \"{0}\" with {1} songs.": "✅ Playlist \"{0}\" creada con {1} canciones.",
      "Error sorting the playlist": "Error al ordenar la playlist",
      "Where is this song?": "¿Dónde está esta canción?",
      "Type part of the title or artist": "Escribe parte del título o del artista",
      "Search all my playlists": "Buscar en todas mis playlists",
      "Looking in {0}/{1}: {2}": "Buscando en {0}/{1}: {2}",
      "{0} song(s) found": "{0} canción(es) encontrada(s)",
      "No song found with that text": "Ninguna canción encontrada con ese texto",
      "Error searching your playlists": "Error al buscar en tus playlists",
      "Backup and restore": "Copia de seguridad y restauración",
      "Back up all my playlists": "Hacer copia de todas mis playlists",
      "Backup ready: {0} playlist(s), {1} song(s), about {2} KB.": "Copia lista: {0} playlist(s), {1} canción(es), unos {2} KB.",
      "Copy backup": "Copiar copia",
      "Download .json": "Descargar .json",
      "Restore from a backup file (.json):": "Restaurar desde un archivo de copia (.json):",
      "The file is not a valid backup": "El archivo no es una copia válida",
      "Playlists in the backup (restored as new playlists):": "Playlists en la copia (se restauran como playlists nuevas):",
      "{0} ({1} songs)": "{0} ({1} canciones)",
      "Restore selected": "Restaurar las seleccionadas",
      "Restoring {0}/{1}: {2}": "Restaurando {0}/{1}: {2}",
      "✅ Restored {0} playlist(s).": "✅ {0} playlist(s) restaurada(s).",
      "{0} (restored)": "{0} (restaurada)",
      "Error in the backup": "Error en la copia",
      "Error restoring": "Error al restaurar",
      "Show a Queue button": "Mostrar un botón Cola",
      "Add to queue": "Añadir a la cola",
      "Added to the queue": "Añadida a la cola",
      "Error adding to the queue": "Error al añadir a la cola",
      "🎶 Queued: {0}": "🎶 En cola: {0}"
  },
};

function tx(key, args) {
  const dict = I18N[CUR_LANG];
  const s = dict && dict[key] != null ? dict[key] : key;
  return args ? s.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? "")) : s;
}

// language of Spotify first, then the system's
function detectLang() {
  const cands = [];
  try {
    cands.push(Spicetify.Locale?.getLocale?.());
  } catch (e) {}
  try {
    cands.push(document.documentElement?.lang);
  } catch (e) {}
  try {
    cands.push(...(navigator.languages || []), navigator.language);
  } catch (e) {}
  for (const c of cands) {
    const l = String(c || "").toLowerCase();
    if (l.startsWith("pt")) return "pt-BR";
    if (l.startsWith("es")) return "es";
    if (l.startsWith("en")) return "en";
  }
  return "en";
}
const resolveLang = (pref) => (pref && pref !== "auto" && LANGS[pref] ? pref : detectLang());
const kindLabel = (k) => ({ add: tx("add"), liked: tx("liked songs"), clean: tx("clean playlist") })[k] || "";


// ---------- utilities ----------
function parse(text) {
  return text
    .split(/\n|;/)
    .map((x) => x.trim().replace(/^(?:\d+\s*[.)\-:]\s*|[-*•·]\s+)/, "").trim())
    .filter((x) => /\p{L}/u.test(x))
    .map((raw) => {
      const m = raw.match(/\s[-–—]\s/);
      const title = m ? raw.slice(0, m.index).trim() : raw;
      let artist = m ? raw.slice(m.index + m[0].length).trim() : "";
      if (/^(various|various artists|vários|varios|vários artistas)$/i.test(artist)) artist = "";
      return { raw, title, artist };
    });
}

const compact = (t) => ({
  uri: t.uri,
  name: t.name,
  artists: (t.artists || []).slice(0, 1).map((a) => ({ name: a.name })),
  album: { images: [{ url: t.album?.images?.[0]?.url || "" }] },
});
const keyOf = (t) => `${t.name}|${t.artists?.[0]?.name || ""}`.toLowerCase().trim();
const labelOf = (t) => `${t.name} - ${t.artists?.[0]?.name || ""}`;
const isDupe = (set, t) => set.has(t.uri) || set.has(keyOf(t));
const markTrack = (set, t) => {
  set.add(t.uri);
  set.add(keyOf(t));
};
const fail = (msg, e) => {
  console.error("[swipe]", msg, e);
  Spicetify.showNotification(e ? `${msg}: ${errText(e)}` : msg, true);
};

function extractPlaylistId(s) {
  const m = (s || "").trim().match(/playlist[\/:]([A-Za-z0-9]+)/);
  return m ? m[1] : "";
}

function copyText(text) {
  try {
    Spicetify.addToClipboard(text);
    Spicetify.showNotification(tx("Copied!"));
  } catch (e) {
    navigator.clipboard?.writeText(text).then(() => Spicetify.showNotification(tx("Copied!")));
  }
}

function downloadText(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- import from file (.txt / .csv) ----------
function parseCsv(text) {
  const first = text.split(/\r?\n/)[0] || "";
  const d = first.split(";").length > first.split(",").length ? ";" : ",";
  const rows = [];
  let row = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) {
      row.push(cur);
      cur = "";
    } else if (ch === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (ch !== "\r") cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function textFromFile(name, content) {
  if (!name.toLowerCase().endsWith(".csv")) return content;
  const rows = parseCsv(content);
  if (!rows.length) return "";
  const head = rows[0].map((c) => c.trim().toLowerCase());
  const find = (names) =>
    head.findIndex((c) => names.some((n) => c === n || (n.includes(" ") && c.startsWith(n))));
  const ti = find(["track name", "track", "title", "name", "música", "musica", "nome"]);
  const ai = find(["artist name", "artist", "artists", "artista", "autor"]);
  const hasHead = ti >= 0;
  const data = hasHead ? rows.slice(1) : rows;
  const T = hasHead ? ti : 0;
  const A = hasHead ? ai : 1;
  return data
    .map((r) => {
      const t = (r[T] || "").trim();
      const a = A >= 0 ? (r[A] || "").split(";")[0].trim() : "";
      return a ? `${t} - ${a}` : t;
    })
    .filter(Boolean)
    .join("\n");
}

// ---------- API calls ----------
// ---------- search ----------
let lastSearchToast = 0;

// finds, anywhere in the response, objects with a uri of the requested type
function collectEntities(node, prefix, out = [], seen = new Set(), depth = 0) {
  if (!node || typeof node !== "object" || depth > 14) return out;
  if (typeof node.uri === "string" && node.uri.startsWith(prefix) && typeof node.name === "string" && !seen.has(node.uri)) {
    seen.add(node.uri);
    out.push(node);
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) collectEntities(v, prefix, out, seen, depth + 1);
  return out;
}

function gqlTrack(n) {
  const artists = Array.isArray(n.artists?.items)
    ? n.artists.items.map((a) => ({ name: a.profile?.name || a.name }))
    : Array.isArray(n.artists)
    ? n.artists
    : [];
  const img =
    n.albumOfTrack?.coverArt?.sources?.[0]?.url || n.album?.coverArt?.sources?.[0]?.url || n.album?.images?.[0]?.url || "";
  return compact({ uri: n.uri, name: n.name, artists: artists.filter((a) => a?.name), album: { images: [{ url: img }] } });
}

// relevance: discards results that have nothing to do with what was searched
const normTokens = (str) =>
  String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2);

function relevance(q, t) {
  const want = normTokens(q);
  if (!want.length) return 1;
  const have = new Set(normTokens(`${t.name} ${(t.artists || []).map((a) => a.name).join(" ")}`));
  return want.filter((w) => have.has(w)).length / want.length;
}

let gqlDeadUntil = 0;
let gqlDeadMsg = "";
const gqlWinner = {};
async function searchGraphQL(type, q, limit, offset) {
  const G = Spicetify.GraphQL;
  if (!G?.Request || !G?.Definitions) throw new Error(tx("GraphQL unavailable"));
  if (Date.now() < gqlDeadUntil) throw new Error(gqlDeadMsg);
  // read-only definitions only (never save/remove recent searches)
  const keys = Object.keys(G.Definitions).filter(
    (k) => /search/i.test(k) && !/recent|save|remove|delete|add/i.test(k)
  );
  if (!keys.length) {
    gqlDeadUntil = Date.now() + 60000;
    gqlDeadMsg = tx("Spotify has no internal search definition (GraphQL)");
    throw new Error(gqlDeadMsg);
  }
  const prefer = ["searchModalResults", "queryInlineCurationSearchV2", "searchModalEntityPage", "assistedCurationSearch", "searchSuggestions"];
  const rank = (k) => (k === gqlWinner[type] ? -1 : prefer.includes(k) ? prefer.indexOf(k) : 99);
  keys.sort((a, b) => rank(a) - rank(b));
  const prefix = type === "track" ? "spotify:track:" : "spotify:playlist:";
  const vars = {
    searchTerm: q,
    offset,
    limit,
    numberOfTopResults: 5,
    includeAudiobooks: true,
    includePreReleases: false,
    includeAuthors: false,
    includeArtistHasConcertsField: false,
    includeLocalConcertsField: false,
  };
  const errs = [];
  let anyOk = false;
  for (const k of keys) {
    try {
      const res = await G.Request(G.Definitions[k], vars);
      const found = collectEntities(res, prefix);
      if (!found.length) {
        errs.push(`${k}: ${res?.errors?.[0]?.message || tx("no results")}`);
        continue;
      }
      anyOk = true;
      if (type === "track") {
        const tracks = found
          .map(gqlTrack)
          .map((t) => ({ t, s: relevance(q, t) }))
          .filter((x) => x.s >= 0.4)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.t);
        if (tracks.length) {
          gqlWinner[type] = k;
          return tracks;
        }
        errs.push(tx("{0}: results unrelated to the search", [k]));
      } else {
        gqlWinner[type] = k;
        return found.map((x) => ({ uri: x.uri, id: x.uri.split(":").pop(), name: x.name }));
      }
    } catch (e) {
      errs.push(`${k}: ${errText(e)}`);
    }
  }
  if (anyOk && type === "track") return []; // the search worked, but this song was not found
  gqlDeadMsg = tx("no internal search definition worked [{0}]", [errs.join("; ").slice(0, 220)]);
  gqlDeadUntil = Date.now() + 15000;
  throw new Error(gqlDeadMsg);
}

// type: "track" (returns songs) or "playlist" (returns {uri, id, name})
async function searchCatalog(type, q, limit, offset) {
  const errs = [];
  try {
    const r = await C.get(
      `${API}/search?q=${encodeURIComponent(q)}&type=${type}&limit=${Math.min(limit, 10)}&offset=${offset}`
    );
    const items = r?.[type === "track" ? "tracks" : "playlists"]?.items;
    if (Array.isArray(items)) {
      const list = items.filter(Boolean);
      if (list.length) {
        return type === "track" ? list.map(compact) : list.map((x) => ({ uri: x.uri, id: x.id, name: x.name }));
      }
      return [];
    }
    throw new Error(tx("response without results"));
  } catch (e) {
    errs.push(`web: ${errText(e)}`);
  }
  try {
    return await searchGraphQL(type, q, limit, offset);
  } catch (e) {
    errs.push(tx("internal search: {0}", [errText(e)]));
  }
  throw new Error(errs.join(" | "));
}

async function searchTrack(entry) {
  const q = `${entry.title} ${entry.artist}`.trim();
  const r = await searchCatalog("track", q, 1, 0);
  return r[0] || null;
}

// 1st attempt: Spotify's internal library (does not depend on the network)
async function playlistsFromRootlist() {
  const root = await Spicetify.Platform.RootlistAPI.getContents();
  const flat = [];
  const walk = (list) => {
    for (const it of list || []) {
      if (it.type === "folder") walk(it.items);
      else if (it.type === "playlist" && it.uri) flat.push(it);
    }
  };
  walk(root?.items);
  const mine = flat.filter((p) => p.isOwnedBySelf || p.isCollaborative || p.canAdd);
  return (mine.length ? mine : flat).map((p) => ({ id: p.uri.split(":").pop(), name: p.name }));
}

// 2nd attempt: web API
async function playlistsFromWebApi() {
  const me = await C.get(`${API}/me`);
  let url = `${API}/me/playlists?limit=50`;
  const all = [];
  while (url && all.length < 500) {
    const r = await C.get(url);
    all.push(...r.items);
    url = r.next;
  }
  return all
    .filter((p) => p && (p.owner?.id === me.id || p.collaborative))
    .map((p) => ({ id: p.id, name: p.name }));
}

async function loadMyPlaylists() {
  const errors = [];
  try {
    const l = await playlistsFromRootlist();
    if (l.length) return { list: l, errors };
    errors.push(tx("internal library came back empty"));
  } catch (e) {
    errors.push(tx("internal library: {0}", [e?.message || e]));
  }
  try {
    const l = await playlistsFromWebApi();
    if (l.length) return { list: l, errors };
    errors.push(tx("web API came back empty"));
  } catch (e) {
    errors.push(tx("web API: {0}", [e?.message || e?.body?.error?.message || e]));
  }
  return { list: [], errors };
}

// ---------- playlists ----------
// Spotify changed the web API in Feb/2026 (/tracks became /items) and reading playlists through the
// web API can fail. So we read through the client's internal API first (Spicetify.Platform)
// and use the web API as plan B.
const plUri = (id) => `spotify:playlist:${id}`;
const errText = (e) => e?.body?.error?.message || e?.message || (e?.status ? tx("status {0}", [e.status]) : String(e));

let SEG = "items";
async function withSeg(fn) {
  const order = SEG === "items" ? ["items", "tracks"] : ["tracks", "items"];
  let firstErr;
  for (const sg of order) {
    try {
      const r = await fn(sg);
      SEG = sg;
      return r;
    } catch (e) {
      firstErr = firstErr || e;
    }
  }
  throw firstErr;
}

// web API entry: "item" (new) or "track" (old)
const entryTrack = (it) => {
  const t = it?.item && typeof it.item === "object" ? it.item : typeof it?.track === "object" ? it.track : null;
  return t && t.uri ? t : null;
};

// accepts a flat item (internal API) or one wrapped in item/track (web API)
function itemToTrack(it) {
  if (!it || typeof it !== "object") return null;
  const t = it.item && typeof it.item === "object" ? it.item : it.track && typeof it.track === "object" ? it.track : it;
  return typeof t.uri === "string" && t.uri ? t : null;
}

// reading through Spotify's internal API
async function internalItems(id) {
  const api = Spicetify.Platform?.PlaylistAPI;
  if (!api?.getContents) throw new Error(tx("PlaylistAPI.getContents does not exist in this version"));
  let lastErr;
  for (const arg of [plUri(id), id]) {
    try {
      const first = await api.getContents(arg);
      const items = Array.isArray(first) ? first : first?.items;
      if (!Array.isArray(items)) throw new Error(tx("unexpected format (no item list)"));
      const all = [...items];
      const total = first?.totalLength ?? first?.total ?? all.length;
      let guard = 0;
      while (all.length < total && guard++ < 100) {
        const r = await api.getContents(arg, { offset: all.length, limit: 200 });
        const more = Array.isArray(r) ? r : r?.items;
        if (!more?.length || (more[0]?.uid && more[0].uid === all[0]?.uid)) break;
        all.push(...more);
      }
      return all;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// keepNulls keeps the real positions in the playlist (needed to remove duplicates); max limits how many to read
async function loadPlaylistTracks(id, keepNulls = false, max = Infinity) {
  const errs = [];
  try {
    const items = await internalItems(id);
    const tracks = items.map((it) => {
      const t = itemToTrack(it);
      return t ? compact(t) : null;
    });
    if (items.length && tracks.every((t) => !t)) throw new Error(tx("items without a uri (unknown format)"));
    const out = keepNulls ? tracks : tracks.filter(Boolean);
    return Number.isFinite(max) ? out.slice(0, max) : out;
  } catch (e) {
    errs.push(tx("internal: {0}", [errText(e)]));
  }
  try {
    return await withSeg(async (sg) => {
      const out = [];
      let url = `${API}/playlists/${id}/${sg}?limit=50`;
      while (url && out.length < max) {
        const r = await C.get(url);
        for (const it of r.items || []) {
          const t = entryTrack(it);
          if (t) out.push(compact(t));
          else if (keepNulls) out.push(null);
        }
        url = r.next;
      }
      return out;
    });
  } catch (e) {
    errs.push(`web: ${errText(e)}`);
  }
  throw new Error(errs.join(" | "));
}

// writing: try the web API and, if it fails, the client's internal API
let webWriteFails = 0;
let webWriteWorks = false;
const webWriteAllowed = () => webWriteWorks || webWriteFails < 2;

const delEntries = (id, chunk, snap) =>
  withSeg((sg) =>
    C.del(`${API}/playlists/${id}/${sg}`, {
      [sg === "items" ? "items" : "tracks"]: chunk,
      ...(snap ? { snapshot_id: snap } : {}),
    })
  );

async function getSnapshot(id) {
  try {
    return (await C.get(`${API}/playlists/${id}?fields=snapshot_id`)).snapshot_id || null;
  } catch (e) {
    return null;
  }
}

let internalAddOk = false;
let internalAddFails = 0;
const internalAddAllowed = () => internalAddOk || internalAddFails < 2;

async function addUri(id, uri) {
  const errs = [];
  const api = Spicetify.Platform?.PlaylistAPI;
  if (api?.add && internalAddAllowed()) {
    let tentativa = 0;
    for (const loc of [{ after: "end" }, { before: "start" }, undefined]) {
      try {
        // if an earlier attempt ended up working late, do not add again
        if (tentativa++ > 0 && (await internalItems(id)).some((it) => it?.uri === uri)) {
          internalAddOk = true;
          return;
        }
        await api.add(plUri(id), [uri], loc);
        if (!internalAddOk) {
          let found = false;
          for (const wait of [300, 700, 1200]) {
            await sleep(wait);
            if ((await internalItems(id)).some((it) => it?.uri === uri)) {
              found = true;
              break;
            }
          }
          if (!found) throw new Error(tx("the internal API accepted it, but the song did not show up in the playlist"));
          internalAddOk = true;
        }
        return;
      } catch (e) {
        errs.push(tx("internal: {0}", [errText(e)]));
      }
    }
    internalAddFails++;
  } else if (!api?.add) {
    errs.push(tx("internal: PlaylistAPI.add does not exist in this version"));
  }
  // before plan B, check whether the song got in anyway (avoids duplicating)
  try {
    if ((await internalItems(id)).some((it) => it?.uri === uri)) return;
  } catch (e) {}
  if (webWriteAllowed()) {
    try {
      await withSeg((sg) => C.post(`${API}/playlists/${id}/${sg}`, { uris: [uri] }));
      webWriteWorks = true;
      return;
    } catch (e) {
      webWriteFails++;
      errs.push(`web: ${errText(e)}`);
    }
  }
  throw new Error(errs.join(" | "));
}

// removal through the internal API (uses each playlist item's "uid")
let internalRemoveOk = false;
async function internalRemove(id, targets) {
  const api = Spicetify.Platform?.PlaylistAPI;
  if (!api?.remove) throw new Error(tx("PlaylistAPI.remove does not exist in this version"));
  const items = await internalItems(id);
  const picks = [];
  for (const t of targets) {
    if (t.pos != null) {
      const it = items[t.pos];
      if (it && it.uri === t.uri) picks.push(it);
    } else {
      items.filter((it) => it.uri === t.uri).forEach((it) => picks.push(it));
    }
  }
  if (!picks.length) throw new Error(tx("could not find the song in the playlist to remove it"));
  await api.remove(plUri(id), picks.map((it) => ({ uri: it.uri, uid: it.uid })));
  if (!internalRemoveOk) {
    const hasUid = picks.every((it) => it.uid != null);
    let gone = false;
    for (const wait of [300, 700, 1200]) {
      await sleep(wait);
      const now = await internalItems(id);
      gone = hasUid
        ? !now.some((it) => it?.uid != null && picks.some((p) => p.uid === it.uid))
        : now.length <= items.length - picks.length;
      if (gone) break;
    }
    if (!gone) throw new Error(tx("the internal API accepted it, but the song is still in the playlist"));
    internalRemoveOk = true;
  }
}

// targets: [{uri}] (all occurrences) or [{uri, pos}] (specific occurrences)
let internalRemoveFails = 0;
const internalRemoveAllowed = () => internalRemoveOk || internalRemoveFails < 2;

async function deleteTargets(id, targets, snap) {
  const errs = [];
  if (internalRemoveAllowed()) {
    try {
      await internalRemove(id, targets);
      return;
    } catch (e) {
      internalRemoveFails++;
      errs.push(tx("internal: {0}", [errText(e)]));
    }
  }
  const hasPos = targets.some((t) => t.pos != null);
  const grouped = new Map();
  for (const t of targets) {
    if (!grouped.has(t.uri)) grouped.set(t.uri, []);
    if (t.pos != null) grouped.get(t.uri).push(t.pos);
  }
  const entries = [...grouped].map(([uri, positions]) => (hasPos ? { uri, positions } : { uri }));
  if (webWriteAllowed() && (!hasPos || snap || entries.length <= 100)) {
    try {
      for (let i = 0; i < entries.length; i += 100) {
        await delEntries(id, entries.slice(i, i + 100), snap);
      }
      webWriteWorks = true;
      return;
    } catch (e) {
      webWriteFails++;
      errs.push(`web: ${errText(e)}`);
    }
  }
  throw new Error(errs.join(" | "));
}

async function delUri(id, uri) {
  await removeUris(id, [uri]);
}

// removes only the last occurrence (the one added last), leaving the other copies alone
async function delLastUri(id, uri) {
  const tracks = await loadPlaylistTracks(id, true);
  let pos = -1;
  tracks.forEach((t, i) => {
    if (t && t.uri === uri) pos = i;
  });
  if (pos < 0) return;
  await deleteTargets(id, [{ uri, pos }], await getSnapshot(id));
}

async function loadPlaylistKeys(id) {
  const set = new Set();
  for (const t of await loadPlaylistTracks(id)) markTrack(set, t);
  return set;
}

async function loadLiked(count, onProgress) {
  const errs = [];
  let out = [];
  try {
    let url = `${API}/me/tracks?limit=50`;
    while (url && out.length < count && !STOP) {
      onProgress(tx("Loading liked songs... {0}", [out.length]));
      const r = await C.get(url);
      for (const it of r.items || []) {
        const t = itemToTrack(it);
        if (t) out.push(compact(t));
      }
      url = r.next;
    }
    return out.slice(0, count);
  } catch (e) {
    errs.push(`web: ${errText(e)}`);
    out = [];
  }
  try {
    const api = Spicetify.Platform?.LibraryAPI;
    if (!api?.getTracks) throw new Error(tx("LibraryAPI.getTracks does not exist in this version"));
    let offset = 0;
    let firstUri = null;
    while (out.length < count && !STOP) {
      onProgress(tx("Loading liked songs... {0}", [out.length]));
      const r = await api.getTracks({ limit: 50, offset });
      const items = Array.isArray(r) ? r : r?.items || [];
      if (!items.length) break;
      const u0 = itemToTrack(items[0])?.uri;
      if (offset > 0 && u0 && u0 === firstUri) break; // the offset was ignored
      if (offset === 0) firstUri = u0;
      for (const it of items) {
        const t = itemToTrack(it);
        if (t) out.push(compact(t));
      }
      offset += items.length;
      const total = r?.totalLength ?? r?.total;
      if (total != null && offset >= total) break;
    }
    return out.slice(0, count);
  } catch (e) {
    errs.push(tx("internal: {0}", [errText(e)]));
  }
  throw new Error(errs.join(" | "));
}

// Finds duplicates inside each playlist and across different playlists
async function scanDuplicates(list, onProgress) {
  const map = new Map();
  for (let i = 0; i < list.length; i++) {
    if (STOP) break;
    onProgress(tx("Reading {0}/{1}: {2}", [i + 1, list.length, list[i].name]));
    let tracks = [];
    try {
      tracks = await loadPlaylistTracks(list[i].id);
    } catch (e) {
      console.error("[swipe] error reading playlist:", list[i].name, e);
      continue;
    }
    for (const t of tracks) {
      const k = keyOf(t);
      if (!map.has(k)) map.set(k, { label: labelOf(t), key: k, where: {} });
      const w = map.get(k).where;
      w[list[i].id] = (w[list[i].id] || 0) + 1;
    }
  }
  const results = [];
  for (const v of map.values()) {
    const total = Object.values(v.where).reduce((a, b) => a + b, 0);
    if (total > 1) results.push(v);
  }
  return results.sort((a, b) => a.label.localeCompare(b.label));
}

// Removes the duplicates of ONE playlist, keeping the first of each
async function removeDuplicates(id) {
  const tracks = await loadPlaylistTracks(id, true);
  const seen = new Set();
  const targets = [];
  tracks.forEach((t, pos) => {
    if (!t || t.uri.startsWith("spotify:local")) return;
    const k = keyOf(t);
    if (seen.has(k)) targets.push({ uri: t.uri, pos });
    else seen.add(k);
  });
  if (targets.length) await deleteTargets(id, targets, await getSnapshot(id));
  return targets.length;
}

// plan: Map(song key -> keep the first occurrence?). false = remove all occurrences
async function removeByPlan(id, plan) {
  const tracks = await loadPlaylistTracks(id, true);
  const seen = new Set();
  const targets = [];
  tracks.forEach((t, pos) => {
    if (!t || t.uri.startsWith("spotify:local")) return;
    const k = keyOf(t);
    if (!plan.has(k)) return;
    if (plan.get(k) && !seen.has(k)) {
      seen.add(k);
      return;
    }
    seen.add(k);
    targets.push({ uri: t.uri, pos });
  });
  if (targets.length) await deleteTargets(id, targets, await getSnapshot(id));
  return targets.length;
}

// Removes one song (by name+artist) from ONE playlist.
// keepFirst = true keeps the first occurrence and removes only the duplicates.
async function removeByKey(id, key, keepFirst) {
  const tracks = await loadPlaylistTracks(id, true);
  const targets = [];
  let seen = false;
  tracks.forEach((t, pos) => {
    if (!t || t.uri.startsWith("spotify:local") || keyOf(t) !== key) return;
    if (keepFirst && !seen) {
      seen = true;
      return;
    }
    seen = true;
    targets.push({ uri: t.uri, pos });
  });
  if (targets.length) await deleteTargets(id, targets, await getSnapshot(id));
  return targets.length;
}

// Removes songs by URI (all occurrences)
async function removeUris(id, uris) {
  await deleteTargets(id, uris.map((uri) => ({ uri })), null);
}

// Finds songs that cannot be played (removed from Spotify or unavailable in your region)
async function scanUnavailable(id) {
  try {
    const items = await internalItems(id);
    const bad = [];
    let nulls = 0;
    for (const it of items) {
      const t = itemToTrack(it);
      if (!t) {
        nulls++;
        continue;
      }
      const unplayable = it.isPlayable === false || t.isPlayable === false || it.is_playable === false || t.is_playable === false;
      const local = String(t.uri).startsWith("spotify:local") || it.isLocal || t.isLocal;
      if (unplayable && !local) bad.push({ uri: t.uri, label: labelOf(compact(t)) });
    }
    return { bad, nulls };
  } catch (e) {
    console.error("[swipe] internal check failed, trying the web API:", e);
  }
  return withSeg(async (sg) => {
    const bad = [];
    let nulls = 0;
    let url = `${API}/playlists/${id}/${sg}?limit=50&market=from_token`;
    while (url) {
      const r = await C.get(url);
      for (const it of r.items || []) {
        const t = entryTrack(it);
        if (!t) nulls++;
        else if (!it.is_local && t.is_playable === false) bad.push({ uri: t.uri, label: labelOf(t) });
      }
      url = r.next;
    }
    return { bad, nulls };
  });
}

// ---------- new playlists, bulk add, sort, find, backup ----------
// finds the playlist that appeared in the library after the one we had before
async function waitForNewPlaylist(before, name) {
  for (const wait of [300, 700, 1200, 2000]) {
    await sleep(wait);
    const { list } = await loadMyPlaylists();
    const fresh = list.filter((p) => !before.has(p.id));
    if (fresh.length) return fresh.find((p) => p.name === name) || fresh[0];
  }
  return null;
}

// creates a playlist and returns {id, name}
async function createPlaylist(name) {
  const before = new Set((await loadMyPlaylists()).list.map((p) => p.id));
  const errs = [];
  const root = Spicetify.Platform?.RootlistAPI;
  if (root?.createPlaylist) {
    for (const loc of [{ before: "start" }, { after: "end" }, undefined]) {
      try {
        await root.createPlaylist(name, loc);
      } catch (e) {
        errs.push(`internal: ${errText(e)}`);
        continue;
      }
      // the call was accepted: never try again (it could create a second playlist)
      const found = await waitForNewPlaylist(before, name);
      if (found) return found;
      throw new Error("the playlist did not show up in your library (it may have been created; check the sidebar)");
    }
  } else {
    errs.push("internal: RootlistAPI.createPlaylist does not exist in this version");
  }
  try {
    const r = await C.post(`${API}/me/playlists`, { name, public: false });
    if (r?.id) return { id: r.id, name: r.name || name };
    errs.push("web API: no id returned");
  } catch (e) {
    errs.push(`web API: ${errText(e)}`);
  }
  throw new Error(errs.join(" | "));
}

// adds many songs at once (100 per call) and checks that they really showed up
let addManyInternalFails = 0;
async function addMany(id, uris, onProgress) {
  const api = Spicetify.Platform?.PlaylistAPI;
  for (let i = 0; i < uris.length; i += 100) {
    if (STOP) return i;
    const chunk = uris.slice(i, i + 100);
    if (onProgress) onProgress(i, uris.length);
    const errs = [];
    let ok = false;
    const before = (await internalItems(id).catch(() => [])).length;
    if (api?.add && addManyInternalFails < 2) {
      try {
        await api.add(plUri(id), chunk, { after: "end" });
        for (const wait of [300, 700, 1200, 2000]) {
          await sleep(wait);
          if ((await internalItems(id)).length >= before + chunk.length) {
            ok = true;
            break;
          }
        }
        if (!ok) errs.push("internal: the songs did not show up in the playlist");
      } catch (e) {
        errs.push(`internal: ${errText(e)}`);
      }
      if (!ok) addManyInternalFails++;
    }
    if (!ok) {
      // before plan B, check whether they got in anyway (avoids duplicating)
      try {
        if ((await internalItems(id)).length >= before + chunk.length) ok = true;
      } catch (e) {}
    }
    if (!ok) {
      try {
        await withSeg((sg) => C.post(`${API}/playlists/${id}/${sg}`, { uris: chunk }));
        ok = true;
      } catch (e) {
        errs.push(`web API: ${errText(e)}`);
      }
    }
    if (!ok) throw new Error(errs.join(" | "));
  }
  return uris.length;
}

const toTime = (v) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) || 0 : 0);

function sortRows(rows, by) {
  const out = [...rows];
  if (by === "random") {
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  if (by === "added-new" || by === "added-old") {
    out.sort((a, b) => (by === "added-new" ? b.added - a.added : a.added - b.added) || a.i - b.i);
    return out;
  }
  const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
  const keys = {
    title: (r) => [r.title, r.artist],
    artist: (r) => [r.artist, r.album, r.title],
    album: (r) => [r.album, r.artist, r.title],
  };
  out.sort((a, b) => {
    const ka = keys[by](a);
    const kb = keys[by](b);
    for (let n = 0; n < ka.length; n++) {
      const c = cmp(ka[n], kb[n]);
      if (c) return c;
    }
    return a.i - b.i;
  });
  return out;
}

// creates a NEW playlist with the songs of another one in a different order (the original is not touched)
async function sortedCopy(srcId, by, newName, onProgress) {
  const items = await internalItems(srcId);
  const rows = [];
  items.forEach((it, i) => {
    const t = itemToTrack(it);
    if (!t || !String(t.uri).startsWith("spotify:track:")) return;
    rows.push({
      uri: t.uri,
      i,
      title: t.name || "",
      artist: t.artists?.[0]?.name || "",
      album: t.album?.name || "",
      added: toTime(it.addedAt ?? t.addedAt),
    });
  });
  if (!rows.length) throw new Error("the playlist has no songs");
  const sorted = sortRows(rows, by);
  const pl = await createPlaylist(newName);
  const count = await addMany(pl.id, sorted.map((r) => r.uri), onProgress);
  return { pl, count };
}

// looks for a song (part of the title/artist) in all the given playlists
async function findSong(query, list, onProgress) {
  const want = normTokens(query);
  const map = new Map();
  if (!want.length) return [];
  for (let i = 0; i < list.length; i++) {
    if (STOP) break;
    onProgress(i + 1, list.length, list[i].name);
    let tracks = [];
    try {
      tracks = await loadPlaylistTracks(list[i].id);
    } catch (e) {
      continue;
    }
    for (const t of tracks) {
      const hay = normTokens(`${t.name} ${(t.artists || []).map((a) => a.name).join(" ")}`).join(" ");
      if (!want.every((w) => hay.includes(w))) continue;
      const k = keyOf(t);
      if (!map.has(k)) map.set(k, { label: labelOf(t), key: k, where: {} });
      const w = map.get(k).where;
      w[list[i].id] = (w[list[i].id] || 0) + 1;
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// backup of all the given playlists (names + songs)
async function buildBackup(list, onProgress) {
  const out = { app: "swipe-playlist", version: 1, exportedAt: new Date().toISOString(), playlists: [] };
  for (let i = 0; i < list.length; i++) {
    if (STOP) break;
    onProgress(i + 1, list.length, list[i].name);
    let tracks;
    try {
      tracks = await loadPlaylistTracks(list[i].id);
    } catch (e) {
      continue;
    }
    out.playlists.push({
      name: list[i].name,
      tracks: tracks
        .filter((t) => t.uri.startsWith("spotify:track:"))
        .map((t) => ({ uri: t.uri, name: t.name, artist: t.artists?.[0]?.name || "" })),
    });
  }
  return out;
}

// is the current Spicetify theme light? (decides the color scheme of the form controls)
function isLightTheme() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--spice-main").trim();
    const m = v.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return false;
    const n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6;
  } catch (e) {
    return false;
  }
}

// ---------- bio and diagnostics ----------
async function loadPlaylistBio(id) {
  const api = Spicetify.Platform?.PlaylistAPI;
  const uri = plUri(id);
  const tries = [
    async () => {
      const r = await api.getMetadata(uri);
      return r?.metadata || r;
    },
    async () => (await api.getPlaylist(uri))?.metadata,
    async () => await C.get(`${API}/playlists/${id}?fields=name,description`),
    async () => await C.get(`${API}/playlists/${id}`),
  ];
  const errs = [];
  for (const f of tries) {
    try {
      const m = await f();
      if (m && (m.name || m.description)) return { name: m.name || "", description: cleanDesc(m.description) };
    } catch (e) {
      errs.push(errText(e));
    }
  }
  throw new Error(errs.join(" | ") || tx("no playlist data"));
}

function methodsOf(obj) {
  if (!obj) return tx("(does not exist)");
  const names = new Set();
  let o = obj;
  for (let i = 0; o && o !== Object.prototype && i < 4; i++) {
    Object.getOwnPropertyNames(o).forEach((n) => {
      try {
        const skip = ["constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "toLocaleString"];
        if (!skip.includes(n) && !n.startsWith("__") && typeof obj[n] === "function") names.add(n);
      } catch (e) {}
    });
    o = Object.getPrototypeOf(o);
  }
  return [...names].join(", ") || tx("(no methods)");
}

async function runDiagnostics(id) {
  const lines = [];
  const P = Spicetify.Platform || {};
  lines.push(`Spotify ${P.version || "?"}`);
  lines.push(`AuthorizationAPI: ${methodsOf(P.AuthorizationAPI)}`);
  lines.push(
    tx("GraphQL (search definitions): {0}", [
      Object.keys(Spicetify.GraphQL?.Definitions || {})
        .filter((k) => /search/i.test(k))
        .join(", ") || tx("(none)")
    ])
  );
  lines.push(`Queue API: addToQueue=${typeof Spicetify.addToQueue}, removeFromQueue=${typeof Spicetify.removeFromQueue}; RootlistAPI.createPlaylist=${typeof P.RootlistAPI?.createPlaylist}`);
  const wait = Math.max(0, Math.ceil((webBlockedUntil - Date.now()) / 1000));
  lines.push(tx("Web API limit: {0}", [wait ? tx("blocked for ~{0}s more (Spotify asked to wait)", [wait]) : tx("not blocked right now")]));
  const t = async (label, fn) => {
    try {
      lines.push(`✅ ${label}: ${await fn()}`);
    } catch (e) {
      lines.push(`❌ ${label}: ${errText(e)}`);
    }
  };
  await t(tx("read playlist (internal)"), async () => {
    const it = await internalItems(id);
    return tx("{0} items", [it.length]);
  });
  await t(tx("client token"), async () => tx("ok ({0} characters)", [(await getToken()).length]));
  await t("web via token (/me)", async () => `ok (${(await tokenFetch("GET", `${API}/me`))?.id || tx("no id")})`);
  await t(tx("web via token (search)"), async () => {
    const r = await tokenFetch("GET", `${API}/search?q=phonk&type=track&limit=1`);
    return tx("{0} result(s)", [r?.tracks?.items?.length ?? 0]);
  });
  await t("web via Cosmos (/me)", async () => {
    const r = await rawCosmos.get(`${API}/me`);
    if (isErrPayload(r)) throw new Error(`${r.code} ${r.error} ${r.message || ""}`.trim());
    return `ok (${r?.id || tx("no id")})`;
  });
  await t(tx("internal search (GraphQL)"), async () => {
    const r = await searchGraphQL("track", "Kordhell Fatality", 3, 0);
    return tx("{0} result(s), 1st: {1}", [r.length, r[0] ? labelOf(r[0]) : "-"]);
  });
  await t(tx("search (path the app uses)"), async () => {
    const r = await searchCatalog("track", "Kordhell Fatality", 3, 0);
    return tx("{0} result(s), 1st: {1}", [r.length, r[0] ? labelOf(r[0]) : "-"]);
  });
  await t(tx("playlist bio"), async () => {
    const b = await loadPlaylistBio(id);
    return `"${b.name}" | ${b.description.slice(0, 60) || tx("(no description)")}`;
  });
  await t("curtidas", async () => {
    const r = await loadLiked(1, () => {});
    return tx("{0} song(s) read", [r.length]);
  });
  lines.push(tx("(this test only reads; it does not add or remove anything)"));
  return lines.join("\n");
}

// adds ONE test song to the playlist and removes it right after, to prove that writing works
async function runWriteTest(id) {
  const lines = [];
  const items0 = await internalItems(id);
  const have = new Set(items0.map((it) => it?.uri));
  const test = [
    "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
    "spotify:track:1301WleyT98MSxVHPZCA6M",
  ].find((u) => !have.has(u));
  if (!test) return tx("The test songs are already in this playlist; pick another playlist.");
  lines.push(tx("Write test with {0} (the playlist has {1} items)", [test, items0.length]));
  try {
    await addUri(id, test);
    await sleep(1200);
    const ok = (await internalItems(id)).some((it) => it?.uri === test);
    lines.push(
      ok
        ? tx("✅ add: worked ({0})", [webWriteWorks ? tx("via the web API") : tx("via the internal API")])
        : tx("❌ add: the song did not show up in the playlist")
    );
  } catch (e) {
    lines.push(tx("❌ add: {0}", [errText(e)]));
    return lines.join("\n");
  }
  try {
    await removeUris(id, [test]);
    await sleep(1200);
    const still = (await internalItems(id)).some((it) => it?.uri === test);
    lines.push(still ? tx("❌ remove: the song is still in the playlist (remove it manually)") : tx("✅ remove: worked"));
  } catch (e) {
    lines.push(tx("❌ remove: {0} (remove the test song manually)", [errText(e)]));
  }
  return lines.join("\n");
}

// ---------- discover songs from the playlist bio ----------
function cleanDesc(str) {
  const t = document.createElement("textarea");
  t.innerHTML = (str || "").replace(/<[^>]*>/g, " ");
  return t.value.replace(/\s+/g, " ").trim();
}

function termsFromBio(name, description) {
  const parts = (description || "")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[\n,;.!?|•·\/]+/)
    .map((x) => x.trim());
  const all = [name, ...parts].map((x) => (x || "").trim().slice(0, 60)).filter((x) => x.length >= 3);
  return [...new Set(all)].slice(0, 8);
}

// Spotify limits search to 10 results per call, so we paginate
async function searchTracksTerm(term, pages) {
  const out = [];
  for (let pg = 0; pg < pages; pg++) {
    const its = await searchCatalog("track", term, 10, pg * 10);
    out.push(...its);
    if (its.length < 10) break;
  }
  return out;
}

// gets songs from public playlists that match the term
async function searchPlaylistTracks(term, n, stats) {
  if (stats.blocked >= 3 && stats.ok === 0) return [];
  const pls = await searchCatalog("playlist", term, n, 0);
  const out = [];
  for (const pl of pls) {
    try {
      out.push(...(await loadPlaylistTracks(pl.id, false, 50)));
      stats.ok++;
    } catch (e) {
      stats.blocked++;
    }
  }
  return out;
}

// ---------- styles ----------
const page = {
  padding: 32,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  maxWidth: 560,
  margin: "0 auto",
};
// colors follow the Spicetify theme (--spice-* variables); the second value is the fallback
const OK = "var(--spice-button, #1db954)";
const BAD = "var(--spice-notification-error, #e22134)";
const OFF = "var(--spice-button-disabled, #555)";
const field = {
  width: "100%",
  padding: 10,
  borderRadius: 6,
  background: "var(--spice-card, #282828)",
  color: "var(--spice-text, #fff)",
  border: "1px solid var(--spice-button-disabled, #555)",
  colorScheme: "dark",
};
const primary = {
  padding: 12,
  borderRadius: 24,
  border: 0,
  background: "var(--spice-button, #1db954)",
  color: "var(--spice-main, #000)",
  fontWeight: 700,
  cursor: "pointer",
};
const tabOff = {
  padding: 12,
  borderRadius: 24,
  border: "1px solid var(--spice-button-disabled, #555)",
  background: "transparent",
  color: "var(--spice-text, #fff)",
  cursor: "pointer",
};
const circle = (bg) => ({
  width: 72,
  height: 72,
  borderRadius: "50%",
  border: 0,
  background: bg,
  color: "#fff",
  fontSize: 32,
  cursor: "pointer",
});
const pill = (bg, off) => ({
  padding: "10px 18px",
  borderRadius: 24,
  border: 0,
  background: off ? OFF : bg,
  color: "#fff",
  fontWeight: 700,
  cursor: off ? "not-allowed" : "pointer",
  opacity: off ? 0.6 : 1,
});
const col = (el, label) =>
  h(
    "div",
    { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6, maxWidth: 110, textAlign: "center" } },
    el,
    h("small", null, label)
  );

// ---------- app ----------
function App() {
  const [phase, setPhase] = R.useState("setup"); // setup | swipe | done
  const [mode, setMode] = R.useState("add"); // add | link | liked | discover | clean | dupes | tools | diag
  const [text, setText] = R.useState("");
  const [linkText, setLinkText] = R.useState("");
  const [playlists, setPlaylists] = R.useState([]);
  const [targets, setTargets] = R.useState([]); // destination playlists
  const [maybeId, setMaybeId] = R.useState(""); // playlist for the "Maybe" button
  const [moveToId, setMoveToId] = R.useState(""); // playlist for the "Move" button (clean mode)
  const [sourceId, setSourceId] = R.useState(""); // playlist to clean / scan for duplicates / tools
  const [likedCount, setLikedCount] = R.useState(100);
  const [kind, setKind] = R.useState("add"); // type of the session in progress
  const [items, setItems] = R.useState([]);
  const [idx, setIdx] = R.useState(0);
  const [track, setTrack] = R.useState(null);
  const [history, setHistory] = R.useState([]);
  const [dupes, setDupes] = R.useState({});
  const [missing, setMissing] = R.useState({});
  const [busy, setBusy] = R.useState(false);
  const [loadMsg, setLoadMsg] = R.useState("");
  const [saved, setSaved] = R.useState(null);
  const [scanTitle, setScanTitle] = R.useState("");
  const [scanResults, setScanResults] = R.useState(null);
  const [scanId, setScanId] = R.useState(null);
  const [scanList, setScanList] = R.useState([]);
  const [confirmRemove, setConfirmRemove] = R.useState(false);
  const [removeMsg, setRemoveMsg] = R.useState("");
  const [toolOut, setToolOut] = R.useState(null);
  const [confirmTool, setConfirmTool] = R.useState(false);
  const cache = R.useRef({});
  const existing = R.useRef({}); // playlist id -> Set of the songs already in it

  const [loadingPl, setLoadingPl] = R.useState(true);
  const [plError, setPlError] = R.useState("");
  const [manualLink, setManualLink] = R.useState("");
  const [bio, setBio] = R.useState(null);
  const [diagOut, setDiagOut] = R.useState("");
  const [searchErr, setSearchErr] = R.useState("");
  const [retryN, setRetryN] = R.useState(0);
  const [discCount, setDiscCount] = R.useState(50);
  const [notice, setNotice] = R.useState("");
  const [removeMode, setRemoveMode] = R.useState("");
  const [newPlName, setNewPlName] = R.useState("");
  const [discOther, setDiscOther] = R.useState(false); // Discover: send the approved songs to another playlist
  const [useQueue, setUseQueue] = R.useState(false); // show the Queue button in the next session
  const [queueOn, setQueueOn] = R.useState(false); // the session in progress has the Queue button
  const [sortBy, setSortBy] = R.useState("title");
  const [sortName, setSortName] = R.useState("");
  const [findQuery, setFindQuery] = R.useState("");
  const [findResults, setFindResults] = R.useState(null);
  const [backupData, setBackupData] = R.useState(null);
  const [restoreData, setRestoreData] = R.useState(null);
  const [restoreSel, setRestoreSel] = R.useState({});
  const [toolMsg, setToolMsg] = R.useState("");
  const [confirmAdd, setConfirmAdd] = R.useState(null); // asks "already in the playlist, add anyway?"
  const seenUris = R.useRef(new Set()); // songs already shown in this list
  const [langPref, setLangPref] = R.useState(() => {
    try {
      return localStorage.getItem(LANG_KEY) || "auto";
    } catch (e) {
      return "auto";
    }
  });
  CUR_LANG = resolveLang(langPref);
  field.colorScheme = isLightTheme() ? "light" : "dark";
  const [discTerms, setDiscTerms] = R.useState("");
  const [discOpts, setDiscOpts] = R.useState({ tracks: true, playlists: true, artists: false });

  const reloadPlaylists = async () => {
    setLoadingPl(true);
    setPlError("");
    const { list, errors } = await loadMyPlaylists();
    setPlaylists(list);
    if (list[0]) setSourceId((s) => s || list[0].id);
    if (!list.length) setPlError(errors.join(" | ") || tx("No playlist found."));
    setLoadingPl(false);
  };

  // plan B: add a playlist by its link
  const addManual = async () => {
    const id = extractPlaylistId(manualLink);
    if (!id) {
      fail(tx("Invalid playlist link"), null);
      return;
    }
    let name = `Playlist ${id.slice(0, 6)}`;
    try {
      const r = await C.get(`${API}/playlists/${id}?fields=name`);
      if (r?.name) name = r.name;
    } catch (e) {
      console.error("[swipe] could not get the playlist name:", e);
    }
    setPlaylists((ps) => (ps.some((p) => p.id === id) ? ps : [...ps, { id, name }]));
    setSourceId((s) => s || id);
    setManualLink("");
  };

  // loads playlists and the saved session
  R.useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (s?.items?.length) setSaved(s);
    } catch (e) {
      console.error(e);
    }
    reloadPlaylists();
  }, []);

  // saves progress
  R.useEffect(() => {
    try {
      if (phase === "swipe") {
        localStorage.setItem(
          SAVE_KEY,
          JSON.stringify({ kind, items, idx, history, dupes, missing, targets, sourceId, maybeId, moveToId, queueOn })
        );
      } else if (phase === "done") {
        localStorage.removeItem(SAVE_KEY);
      }
    } catch (e) {
      console.error("[swipe] could not save progress:", e);
    }
  }, [phase, idx, history]);

  const resolve = (i) => {
    if (!cache.current[i]) {
      cache.current[i] = items[i].track ? Promise.resolve(items[i].track) : searchTrack(items[i]);
    }
    return cache.current[i];
  };

  // searches/plays the current song
  R.useEffect(() => {
    if (phase !== "swipe") return;
    if (idx >= items.length) {
      setTrack(null);
      setPhase("done");
      Spicetify.Player.pause();
      return;
    }
    let cancelled = false;
    setTrack(null);
    setSearchErr("");
    setConfirmAdd(null);
    resolve(idx).then((t) => {
      if (cancelled) return;
      if (!t) {
        setMissing((m) => ({ ...m, [idx]: items[idx].raw }));
        setIdx((i) => i + 1);
        return;
      }
      if (kind !== "clean" && targets.some((id) => existing.current[id] && isDupe(existing.current[id], t))) {
        Spicetify.showNotification(tx("Already in the playlist: {0}", [labelOf(t)]));
      }
      if (kind !== "clean" && seenUris.current.has(t.uri)) {
        setDupes((d) => ({ ...d, [idx]: labelOf(t) }));
        setNotice(tx("⚠ \"{0}\" already appeared earlier in this list, so I skipped it.", [labelOf(t)]));
        setIdx((i) => i + 1);
        return;
      }
      seenUris.current.add(t.uri);
      setTrack(t);
      Spicetify.Player.playUri(t.uri);
    }).catch((e) => {
      if (cancelled) return;
      delete cache.current[idx];
      setSearchErr(errText(e));
    });
    if (idx + 1 < items.length) {
      resolve(idx + 1).catch(() => {
        delete cache.current[idx + 1];
      }); // prefetches the next one
    }
    return () => {
      cancelled = true;
    };
  }, [phase, idx, retryN]);

  const loadExisting = async (ids) => {
    const ex = {};
    for (const id of [...new Set(ids.filter(Boolean))]) {
      try {
        ex[id] = await loadPlaylistKeys(id);
      } catch (e) {
        fail(tx("Could not read a playlist; duplicates won't be checked for it"), e);
        ex[id] = new Set();
      }
    }
    return ex;
  };

  // ---------- start sessions ----------
  const begin = async (newKind, list, tgs, src, mb, mv) => {
    setBusy(true);
    existing.current = await loadExisting(newKind === "clean" ? [mv] : [...tgs, mb]);
    cache.current = {};
    seenUris.current = new Set();
    setNotice("");
    setKind(newKind);
    setItems(list);
    setTargets(tgs);
    setSourceId((cur) => src || cur);
    setMaybeId(mb);
    setMoveToId(mv);
    setQueueOn(newKind !== "clean" && useQueue);
    setIdx(0);
    setHistory([]);
    setDupes({});
    setMissing({});
    setTrack(null);
    setBusy(false);
    setLoadMsg("");
    setPhase("swipe");
  };

  const startAdd = () => {
    const list = parse(text);
    if (!list.length || !targets.length || busy) return;
    begin("add", list, targets, "", maybeId, "");
  };

  const startLink = async () => {
    if (busy || !targets.length) return;
    const id = extractPlaylistId(linkText);
    if (!id) {
      fail(tx("Invalid playlist link"), null);
      return;
    }
    setBusy(true);
    setLoadMsg(tx("Reading the playlist..."));
    try {
      const tr = (await loadPlaylistTracks(id)).filter((t) => t.uri.startsWith("spotify:track:"));
      if (!tr.length) {
        fail(tx("No songs found in that playlist"), null);
        setBusy(false);
        setLoadMsg("");
        return;
      }
      await begin("add", tr.map((t) => ({ track: t })), targets, "", maybeId, "");
    } catch (e) {
      fail(tx("Could not read that playlist (it must be public)"), e);
      setBusy(false);
      setLoadMsg("");
    }
  };

  const startLiked = async () => {
    if (!targets.length || busy) return;
    setBusy(true);
    STOP = false;
    setLoadMsg(tx("Loading liked songs..."));
    try {
      const n = Number(likedCount) > 0 ? Number(likedCount) : Infinity;
      const liked = await loadLiked(n, setLoadMsg);
      if (!liked.length) {
        fail(tx("No liked songs found"), null);
        setBusy(false);
        setLoadMsg("");
        return;
      }
      await begin("liked", liked.map((t) => ({ track: t })), targets, "", maybeId, "");
    } catch (e) {
      fail(tx("Error loading liked songs"), e);
      setBusy(false);
      setLoadMsg("");
    }
  };

  const startClean = async () => {
    if (!sourceId || busy) return;
    setBusy(true);
    setLoadMsg(tx("Reading the playlist..."));
    try {
      const tr = (await loadPlaylistTracks(sourceId)).filter((t) => !t.uri.startsWith("spotify:local"));
      if (!tr.length) {
        fail(tx("That playlist is empty"), null);
        setBusy(false);
        setLoadMsg("");
        return;
      }
      const mv = moveToId && moveToId !== sourceId ? moveToId : "";
      await begin("clean", tr.map((t) => ({ track: t })), [], sourceId, "", mv);
    } catch (e) {
      fail(tx("Error reading the playlist"), e);
      setBusy(false);
      setLoadMsg("");
    }
  };

  const doWriteTest = async () => {
    if (busy || !sourceId) return;
    setBusy(true);
    setLoadMsg(tx("Testing writing..."));
    try {
      const out = await runWriteTest(sourceId);
      setDiagOut((prev) => (prev ? prev + "\n\n" : "") + out);
    } catch (e) {
      fail(tx("Error in the write test"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const doDiag = async () => {
    if (busy || !sourceId) return;
    setBusy(true);
    setLoadMsg(tx("Testing..."));
    try {
      setDiagOut(await runDiagnostics(sourceId));
    } catch (e) {
      fail(tx("Error in the diagnostics"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const loadBio = async () => {
    if (busy || !sourceId) return;
    setBusy(true);
    setLoadMsg(tx("Reading the bio..."));
    try {
      const b = await loadPlaylistBio(sourceId);
      setBio(b);
      setDiscTerms(termsFromBio(b.name, b.description).join("\n"));
    } catch (e) {
      fail(tx("Could not read the playlist bio"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const startDiscover = async () => {
    if (busy || !sourceId) return;
    const terms = discTerms.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!terms.length) return;
    const want = Math.max(1, parseInt(discCount, 10) || 50);
    STOP = false;
    setBusy(true);
    const destIds = discOther && targets.length ? targets : [sourceId];
    const have = new Set();
    try {
      setLoadMsg(tx("Reading the playlist..."));
      for (const d of destIds) (await loadPlaylistKeys(d)).forEach((k) => have.add(k));
    } catch (e) {
      console.error("[swipe] could not read the playlist before searching:", e);
    }
    const found = new Map();
    const add = (list) =>
      list.forEach((t) => {
        if (t.uri.startsWith("spotify:track:") && !found.has(t.uri) && !isDupe(have, t)) found.set(t.uri, t);
      });
    const enough = () => STOP || found.size >= Math.max(want * 2, want + 20);
    const stats = { ok: 0, blocked: 0 };
    try {
      for (let i = 0; i < terms.length && !enough(); i++) {
        setLoadMsg(tx("Searching \"{0}\" ({1}/{2}) — {3} new so far", [terms[i], i + 1, terms.length, found.size]));
        if (discOpts.tracks) {
          try {
            add(await searchTracksTerm(terms[i], 3));
          } catch (e) {
            console.error("[swipe] song search failed:", e);
          }
        }
        if (discOpts.playlists && !enough()) {
          try {
            add(await searchPlaylistTracks(terms[i], 3, stats));
          } catch (e) {
            console.error("[swipe] playlist search failed:", e);
          }
        }
      }
      if (discOpts.artists && !enough()) {
        setLoadMsg(tx("Reading the playlist's artists..."));
        try {
          const cur = await loadPlaylistTracks(sourceId);
          const count = new Map();
          cur.forEach((t) => {
            const a = t.artists?.[0]?.name;
            if (a) count.set(a, (count.get(a) || 0) + 1);
          });
          const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 5).map((x) => x[0]);
          for (const a of top) {
            if (enough()) break;
            setLoadMsg(tx("More from {0}...", [a]));
            try {
              add(await searchTracksTerm(`artist:"${a}"`, 2));
            } catch (e) {
              console.error(e);
            }
          }
        } catch (e) {
          console.error("[swipe] could not read the artists:", e);
        }
      }
      let list = [...found.values()];
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      list = list.slice(0, want);
      if (!list.length) {
        fail(STOP ? tx("Search cancelled") : tx("No new songs found for those terms"), null);
        setBusy(false);
        setLoadMsg("");
        return;
      }
      if (stats.blocked && !stats.ok) {
        Spicetify.showNotification(tx("Spotify didn't allow reading other people's playlists; I only used the song search"), true);
      }
      STOP = false;
      await begin("add", list.map((t) => ({ track: t })), destIds, "", maybeId, "");
    } catch (e) {
      fail(tx("Search error"), e);
      setBusy(false);
      setLoadMsg("");
    }
  };

  // ---------- new playlist as a destination ----------
  const createAndSelect = async () => {
    const name = newPlName.trim();
    if (!name || busy) return;
    setBusy(true);
    setLoadMsg(tx("Creating the playlist..."));
    try {
      const p = await createPlaylist(name);
      setPlaylists((ps) => (ps.some((x) => x.id === p.id) ? ps : [...ps, { id: p.id, name: p.name }]));
      setTargets((tg) => (tg.includes(p.id) ? tg : [...tg, p.id]));
      setNewPlName("");
      Spicetify.showNotification(tx("Playlist created: {0}", [p.name]));
    } catch (e) {
      fail(tx("Could not create the playlist"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  // ---------- sort into a new playlist ----------
  const doSort = async () => {
    if (busy || !sourceId) return;
    const name = sortName.trim() || tx("{0} (sorted)", [nameOf(sourceId)]);
    STOP = false;
    setBusy(true);
    setToolOut(null);
    setToolMsg("");
    try {
      const r = await sortedCopy(sourceId, sortBy, name, (done, total) =>
        setLoadMsg(tx("Adding songs {0}/{1}...", [done, total]))
      );
      setPlaylists((ps) => (ps.some((x) => x.id === r.pl.id) ? ps : [...ps, { id: r.pl.id, name: r.pl.name }]));
      setToolMsg(tx("✅ Created \"{0}\" with {1} songs.", [r.pl.name, r.count]));
    } catch (e) {
      fail(tx("Error sorting the playlist"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  // ---------- where is this song? ----------
  const doFind = async () => {
    if (busy || !findQuery.trim()) return;
    STOP = false;
    setBusy(true);
    setFindResults(null);
    try {
      setFindResults(
        await findSong(findQuery, playlists, (i, n, name) => setLoadMsg(tx("Looking in {0}/{1}: {2}", [i, n, name])))
      );
    } catch (e) {
      fail(tx("Error searching your playlists"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const removeFound = async (r, id) => {
    if (busy) return;
    setBusy(true);
    setLoadMsg(tx("Removing in {0}...", [nameOf(id)]));
    try {
      await removeByKey(id, r.key, false);
      Spicetify.showNotification(tx("Removed from {0}", [nameOf(id)]));
      setFindResults((rs) =>
        rs
          .map((x) => {
            if (x.key !== r.key) return x;
            const where = { ...x.where };
            delete where[id];
            return { ...x, where };
          })
          .filter((x) => Object.keys(x.where).length > 0)
      );
    } catch (e) {
      fail(tx("Error removing"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  // ---------- backup / restore ----------
  const doBackup = async () => {
    if (busy || !playlists.length) return;
    STOP = false;
    setBusy(true);
    setBackupData(null);
    try {
      const data = await buildBackup(playlists, (i, n, name) => setLoadMsg(tx("Reading {0}/{1}: {2}", [i, n, name])));
      const text = JSON.stringify(data);
      setBackupData({
        text,
        n: data.playlists.length,
        m: data.playlists.reduce((a, p) => a + p.tracks.length, 0),
        kb: Math.round(text.length / 1024),
      });
    } catch (e) {
      fail(tx("Error in the backup"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const onRestoreFile = async (e) => {
    const input = e.target;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.playlists)) throw new Error("no playlists in the file");
      setRestoreData(data);
      setRestoreSel(Object.fromEntries(data.playlists.map((_, i) => [i, true])));
    } catch (err) {
      setRestoreData(null);
      fail(tx("The file is not a valid backup"), err);
    }
    input.value = "";
  };

  const doRestore = async () => {
    if (busy || !restoreData) return;
    const picks = restoreData.playlists.map((p, i) => ({ p, i })).filter((x) => restoreSel[x.i]);
    if (!picks.length) return;
    STOP = false;
    setBusy(true);
    setToolMsg("");
    let ok = 0;
    try {
      for (let n = 0; n < picks.length && !STOP; n++) {
        const { p } = picks[n];
        setLoadMsg(tx("Restoring {0}/{1}: {2}", [n + 1, picks.length, p.name]));
        const pl = await createPlaylist(tx("{0} (restored)", [p.name]));
        const uris = (p.tracks || []).map((t) => t.uri).filter((u) => typeof u === "string" && u.startsWith("spotify:track:"));
        await addMany(pl.id, uris);
        setPlaylists((ps) => (ps.some((x) => x.id === pl.id) ? ps : [...ps, { id: pl.id, name: pl.name }]));
        ok++;
      }
      setToolMsg(tx("✅ Restored {0} playlist(s).", [ok]));
    } catch (e) {
      fail(tx("Error restoring"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  // ---------- queue ----------
  const queueCurrent = async () => {
    if (!track || busy) return;
    setBusy(true);
    try {
      await Spicetify.addToQueue([{ uri: track.uri }]);
      setNotice("");
      setConfirmAdd(null);
      setHistory((hs) => [...hs, { idx, type: "queued", uri: track.uri, label: labelOf(track) }]);
      setIdx((i) => i + 1);
      Spicetify.showNotification(tx("Added to the queue"));
    } catch (e) {
      fail(tx("Error adding to the queue"), e);
    }
    setBusy(false);
  };

  const resume = async () => {
    if (!saved || busy) return;
    setBusy(true);
    setLoadMsg(tx("Resuming..."));
    existing.current = await loadExisting(
      saved.kind === "clean" ? [saved.moveToId] : [...(saved.targets || []), saved.maybeId]
    );
    cache.current = {};
    seenUris.current = new Set((saved.history || []).map((x) => x.uri).filter(Boolean));
    setNotice("");
    setKind(saved.kind);
    setItems(saved.items);
    setTargets(saved.targets || []);
    setSourceId((cur) => saved.sourceId || cur);
    setMaybeId(saved.maybeId || "");
    setMoveToId(saved.moveToId || "");
    setQueueOn(!!saved.queueOn);
    setIdx(saved.idx);
    setHistory(saved.history || []);
    setDupes(saved.dupes || {});
    setMissing(saved.missing || {});
    setTrack(null);
    setSaved(null);
    setBusy(false);
    setLoadMsg("");
    setPhase("swipe");
  };

  const discardSaved = () => {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) {}
    setSaved(null);
  };

  const stopAndSave = () => {
    Spicetify.Player.pause();
    try {
      setSaved(JSON.parse(localStorage.getItem(SAVE_KEY) || "null"));
    } catch (e) {}
    setPhase("setup");
  };

  // ---------- swipe actions ----------
  const accept = async (ids, type = "added") => {
    if (!track || busy) return;
    const dupIn = ids.filter((id) => existing.current[id] && isDupe(existing.current[id], track));
    setBusy(true);
    try {
      for (const id of ids) {
        await addUri(id, track.uri);
        if (!existing.current[id]) existing.current[id] = new Set();
        markTrack(existing.current[id], track);
      }
      setHistory((hs) => [
        ...hs,
        { idx, type, uri: track.uri, key: keyOf(track), label: labelOf(track), targets: ids, dupIn },
      ]);
      setNotice("");
      setConfirmAdd(null);
      setIdx((i) => i + 1);
    } catch (e) {
      fail(tx("Error adding to the playlist"), e);
    }
    setBusy(false);
  };

  const pass = (type) => {
    if (!track || busy) return;
    setNotice("");
    setHistory((hs) => [...hs, { idx, type, uri: track.uri }]);
    setIdx((i) => i + 1);
  };

  const skipFailed = () => {
    setMissing((m) => ({ ...m, [idx]: items[idx]?.raw || "?" }));
    setSearchErr("");
    setNotice("");
    setIdx((i) => i + 1);
  };

  const removeCurrent = async () => {
    if (!track || busy) return;
    setBusy(true);
    try {
      await delUri(sourceId, track.uri);
      setNotice("");
      setHistory((hs) => [...hs, { idx, type: "removed", uri: track.uri, label: labelOf(track) }]);
      setIdx((i) => i + 1);
    } catch (e) {
      fail(tx("Error removing from the playlist"), e);
    }
    setBusy(false);
  };

  // adds to the other playlist and removes from the current one
  const moveCurrent = async () => {
    if (!track || busy || !moveToId) return;
    setBusy(true);
    try {
      const set = existing.current[moveToId];
      const had = !!(set && isDupe(set, track));
      if (!had) {
        await addUri(moveToId, track.uri);
        if (!existing.current[moveToId]) existing.current[moveToId] = new Set();
        markTrack(existing.current[moveToId], track);
      }
      await delUri(sourceId, track.uri);
      setNotice("");
      setHistory((hs) => [
        ...hs,
        { idx, type: "moved", uri: track.uri, key: keyOf(track), label: labelOf(track), to: moveToId, wasAdded: !had },
      ]);
      setIdx((i) => i + 1);
    } catch (e) {
      fail(tx("Error moving the song"), e);
    }
    setBusy(false);
  };

  const undo = async () => {
    if (!history.length || busy) return;
    const last = history[history.length - 1];
    setBusy(true);
    try {
      if (last.type === "added" || last.type === "maybe") {
        for (const id of last.targets) {
          if (last.dupIn?.includes(id)) {
            await delLastUri(id, last.uri); // only the copy I just added
          } else {
            await delUri(id, last.uri);
            existing.current[id]?.delete(last.uri);
            existing.current[id]?.delete(last.key);
          }
        }
      } else if (last.type === "removed") {
        await addUri(sourceId, last.uri);
      } else if (last.type === "moved") {
        await addUri(sourceId, last.uri);
        if (last.wasAdded) {
          await delUri(last.to, last.uri);
          existing.current[last.to]?.delete(last.uri);
          existing.current[last.to]?.delete(last.key);
        }
      } else if (last.type === "queued") {
        try {
          await Spicetify.removeFromQueue([{ uri: last.uri }]);
        } catch (e) {
          console.error("[swipe] could not remove from the queue:", e);
        }
      }
      seenUris.current.delete(last.uri);
      setNotice("");
      setHistory((hs) => hs.slice(0, -1));
      setIdx(last.idx);
      setPhase("swipe");
    } catch (e) {
      fail(tx("Error undoing"), e);
    }
    setBusy(false);
  };

  // ---------- duplicates ----------
  const runScan = async (list, title, singleId) => {
    if (busy || !list.length) return;
    setBusy(true);
    STOP = false;
    setScanResults(null);
    setConfirmRemove(false);
    setRemoveMsg("");
    try {
      const res = await scanDuplicates(list, setLoadMsg);
      setScanTitle(title);
      setScanResults(res);
      setScanId(singleId);
      setScanList(list.map((p) => ({ id: p.id, name: p.name })));
    } catch (e) {
      fail(tx("Error searching for duplicates"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const doRemove = async (mode) => {
    if (!(confirmRemove && removeMode === mode)) {
      setRemoveMode(mode);
      setConfirmRemove(true);
      return;
    }
    setBusy(true);
    setLoadMsg(tx("Removing..."));
    try {
      let n = 0;
      if (mode === "within") {
        const ids = scanId ? [scanId] : scanList.map((p) => p.id);
        for (const id of ids) {
          setLoadMsg(tx("Removing in {0}...", [nameOf(id)]));
          n += await removeDuplicates(id);
        }
        setRemoveMsg(tx("🗑 {0} duplicate(s) removed. One of each is left in every playlist.", [n]));
        setScanResults((rs) =>
          rs
            .map((r) => ({
              ...r,
              where: Object.fromEntries(Object.keys(r.where).map((id) => [id, 1])),
            }))
            .filter((r) => Object.keys(r.where).length > 1)
        );
      } else {
        // global: keeps ONE copy of each song (in the first playlist where it appears) and removes the rest
        const plans = new Map();
        for (const r of scanResults) {
          const owners = scanList.filter((p) => r.where[p.id]);
          owners.forEach((p, i) => {
            if (!plans.has(p.id)) plans.set(p.id, new Map());
            plans.get(p.id).set(r.key, i === 0);
          });
        }
        for (const [id, plan] of plans) {
          setLoadMsg(tx("Removing in {0}...", [nameOf(id)]));
          n += await removeByPlan(id, plan);
        }
        setRemoveMsg(tx("🗑 {0} copy(ies) removed. Only 1 of each song is left.", [n]));
        setScanResults([]);
      }
    } catch (e) {
      fail(tx("Error removing duplicates"), e);
    }
    setConfirmRemove(false);
    setRemoveMode("");
    setLoadMsg("");
    setBusy(false);
  };

  const removeOne = async (r, id, c) => {
    if (busy) return;
    setBusy(true);
    setLoadMsg(tx("Removing in {0}...", [nameOf(id)]));
    try {
      await removeByKey(id, r.key, c > 1);
      Spicetify.showNotification(c > 1 ? tx("Duplicate removed") : tx("Removed from {0}", [nameOf(id)]));
      setScanResults((rs) =>
        rs
          .map((x) => {
            if (x.key !== r.key) return x;
            const where = { ...x.where };
            if (c > 1) where[id] = 1;
            else delete where[id];
            return { ...x, where };
          })
          .filter((x) => Object.values(x.where).reduce((a, b) => a + b, 0) > 1)
      );
    } catch (e) {
      fail(tx("Error removing"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  // ---------- tools ----------
  const doExport = async () => {
    if (busy || !sourceId) return;
    setBusy(true);
    setLoadMsg(tx("Reading the playlist..."));
    setToolOut(null);
    try {
      const tr = await loadPlaylistTracks(sourceId);
      setToolOut({ type: "export", name: nameOf(sourceId), count: tr.length, text: tr.map(labelOf).join("\n") });
    } catch (e) {
      fail(tx("Error exporting the playlist"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const doUnavail = async () => {
    if (busy || !sourceId) return;
    setBusy(true);
    setLoadMsg(tx("Checking the playlist..."));
    setToolOut(null);
    setConfirmTool(false);
    try {
      const r = await scanUnavailable(sourceId);
      setToolOut({ type: "unavail", id: sourceId, bad: r.bad, nulls: r.nulls });
    } catch (e) {
      fail(tx("Error checking the playlist"), e);
    }
    setLoadMsg("");
    setBusy(false);
  };

  const removeBad = async (uris) => {
    if (busy) return;
    setBusy(true);
    try {
      await removeUris(toolOut.id, uris);
      setToolOut((o) => ({ ...o, bad: o.bad.filter((b) => !uris.includes(b.uri)) }));
      Spicetify.showNotification(tx("{0} removed", [uris.length]));
    } catch (e) {
      fail(tx("Error removing"), e);
    }
    setConfirmTool(false);
    setBusy(false);
  };

  const removeAllBad = () => {
    if (!confirmTool) {
      setConfirmTool(true);
      return;
    }
    removeBad([...new Set(toolOut.bad.map((b) => b.uri))]);
  };

  const onFile = async (e) => {
    const input = e.target;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const content = await f.text();
      const out = textFromFile(f.name, content);
      setText((t) => (t.trim() ? t.trim() + "\n" : "") + out);
    } catch (err) {
      fail(tx("Could not read the file"), err);
    }
    input.value = "";
  };

  // ---------- screens ----------
  const nameOf = (id) => playlists.find((p) => p.id === id)?.name || "";
  const cnt = (t) => history.filter((x) => x.type === t).length;

  if (phase === "swipe") {
    const img = track?.album?.images?.[0]?.url;
    const tgtList = targets.map((id) => playlists.find((p) => p.id === id)).filter(Boolean);
    const have = (id) => track && existing.current[id] && isDupe(existing.current[id], track);
    const off = busy || !track;
    const dupIn = kind === "clean" ? [] : tgtList.filter((p) => have(p.id));
    // if the song is already in the playlist, ask before adding it again
    const askAdd = (ids, type = "added") => {
      const dups = ids.filter((id) => have(id));
      if (dups.length) setConfirmAdd({ ids, type, dups });
      else accept(ids, type);
    };
    const row = { display: "flex", gap: 40, alignItems: "flex-start", justifyContent: "center" };
    const skipBtn = h("button", { onClick: () => pass("skipped"), disabled: off, style: circle(BAD) }, "✕");
    const maybeBtn = maybeId
      ? col(
          h(
            "button",
            { onClick: () => askAdd([maybeId], "maybe"), disabled: off, style: circle("#e0a800") },
            "?"
          ),
          have(maybeId) ? tx("Maybe (already there)") : tx("Maybe ({0})", [nameOf(maybeId)])
        )
      : null;

    const queueBtn = queueOn
      ? col(h("button", { onClick: queueCurrent, disabled: off, style: circle("#7c4dff") }, "♪"), tx("Add to queue"))
      : null;

    let actions;
    if (kind === "clean") {
      const moveBtn = moveToId
        ? col(
            h("button", { onClick: moveCurrent, disabled: off, style: circle("#2d73ff") }, "➜"),
            tx("Move to {0}", [nameOf(moveToId)])
          )
        : null;
      actions = h(
        "div",
        { style: row },
        col(h("button", { onClick: removeCurrent, disabled: off, style: circle(BAD) }, "✕"), tx("Remove from playlist")),
        moveBtn,
        col(h("button", { onClick: () => pass("kept"), disabled: off, style: circle(OK) }, "✓"), tx("Keep"))
      );
    } else if (tgtList.length === 1) {
      actions = h(
        "div",
        { style: row },
        col(skipBtn, tx("Skip")),
        maybeBtn,
        queueBtn,
        col(
          h("button", { onClick: () => askAdd([tgtList[0].id]), disabled: off, style: circle(OK) }, "✓"),
          dupIn.length ? tx("Add anyway") : tx("Add")
        )
      );
    } else {
      actions = h(
        "div",
        { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16 } },
        h(
          "div",
          { style: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" } },
          tgtList.map((p) =>
            h(
              "button",
              {
                key: p.id,
                onClick: () => askAdd([p.id]),
                disabled: off,
                style: pill(have(p.id) ? "#e0a800" : OK, off),
              },
              have(p.id) ? tx("{0} (already there)", [p.name]) : `+ ${p.name}`
            )
          )
        ),
        h("div", { style: row }, col(skipBtn, tx("Skip")), maybeBtn, queueBtn)
      );
    }

    const confirmPanel = confirmAdd
      ? h(
          "div",
          { style: { ...field, display: "flex", flexDirection: "column", gap: 10 } },
          h(
            "div",
            null,
            tx("\"{0}\" is already in {1}. Add it anyway? It will be duplicated.", [track ? labelOf(track) : "", confirmAdd.dups.map((id) => nameOf(id)).join(", ")])
          ),
          h(
            "div",
            { style: { display: "flex", gap: 8, justifyContent: "center" } },
            h(
              "button",
              {
                onClick: () => {
                  const c = confirmAdd;
                  setConfirmAdd(null);
                  accept(c.ids, c.type);
                },
                disabled: busy,
                style: pill(BAD, busy),
              },
              tx("Yes, add again")
            ),
            h("button", { onClick: () => setConfirmAdd(null), style: tabOff }, tx("No, go back"))
          )
        )
      : null;

    const header =
      kind === "clean"
        ? tx("Cleaning: {0}", [nameOf(sourceId)])
        : tgtList.length === 1
        ? `→ ${tgtList[0].name}`
        : tx("→ choose the playlist");

    return h(
      "div",
      { style: { ...page, alignItems: "center", textAlign: "center" } },
      h("div", null, `${Math.min(idx + 1, items.length)}/${items.length}  •  ${header}`),
      notice ? h("div", { style: { ...field, color: "#ffd166" } }, notice) : null,
      img
        ? h("img", { src: img, style: { width: 320, height: 320, borderRadius: 12, objectFit: "cover" } })
        : searchErr
        ? h(
            "div",
            { style: { width: 320, minHeight: 320, display: "flex", flexDirection: "column", gap: 12, justifyContent: "center" } },
            h("div", null, tx("⚠ The search failed: {0}", [searchErr])),
            h("button", { onClick: () => setRetryN((n) => n + 1), style: primary }, tx("Try again")),
            h("button", { onClick: skipFailed, style: tabOff }, tx("Skip this song"))
          )
        : h("div", { style: { width: 320, height: 320, display: "grid", placeItems: "center" } }, tx("Searching...")),
      h("h2", null, track?.name || ""),
      h("div", null, track?.artists?.map((a) => a.name).join(", ") || ""),
      dupIn.length && !confirmAdd
        ? h("div", { style: { ...field, color: "#ffd166" } }, tx("⚠ This song is already in: {0}.", [dupIn.map((p) => p.name).join(", ")]))
        : null,
      confirmAdd ? confirmPanel : actions,
      h(
        "div",
        { style: { display: "flex", gap: 8 } },
        h("button", { onClick: undo, disabled: busy || !history.length, style: tabOff }, tx("↩ Undo")),
        h("button", { onClick: stopAndSave, style: tabOff }, tx("Stop and save"))
      )
    );
  }

  if (phase === "done") {
    const missList = Object.values(missing);
    return h(
      "div",
      { style: page },
      h("h1", null, tx("Done!")),
      kind === "clean"
        ? [
            h("div", { key: "a" }, tx("🗑 Removed: {0}", [cnt("removed")])),
            h("div", { key: "b" }, tx("✅ Kept: {0}", [cnt("kept")])),
            moveToId ? h("div", { key: "c" }, tx("➜ Moved: {0}", [cnt("moved")])) : null,
          ]
        : [
            h("div", { key: "a" }, tx("✅ Added: {0}", [cnt("added")])),
            maybeId ? h("div", { key: "m" }, tx("❔ In Maybe: {0}", [cnt("maybe")])) : null,
            queueOn ? h("div", { key: "q" }, tx("🎶 Queued: {0}", [cnt("queued")])) : null,
            h("div", { key: "b" }, tx("✕ Skipped: {0}", [cnt("skipped")])),
            h("div", { key: "c" }, tx("🔁 Repeated in the list (skipped): {0}", [Object.keys(dupes).length])),
            h("div", { key: "d" }, tx("❓ Not found: {0}", [missList.length])),
            missList.length ? h("pre", { key: "e", style: { whiteSpace: "pre-wrap" } }, missList.join("\n")) : null,
          ],
      h("button", { onClick: undo, disabled: busy || !history.length, style: tabOff }, tx("↩ Undo last")),
      h("button", { onClick: () => setPhase("setup"), style: primary }, tx("Back to start"))
    );
  }

  // ----- setup -----
  const tabs = h(
    "div",
    { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
    [
      ["add", tx("Add songs")],
      ["link", tx("By link")],
      ["liked", tx("Liked Songs")],
      ["discover", tx("Discover")],
      ["clean", tx("Clean playlist")],
      ["dupes", tx("Duplicates")],
      ["tools", tx("Tools")],
      ["diag", tx("Diagnostics")],
    ].map(([m, label]) =>
      h("button", { key: m, onClick: () => setMode(m), style: mode === m ? primary : tabOff }, label)
    )
  );

  const savedBanner = saved
    ? h(
        "div",
        { style: { ...field, display: "flex", flexDirection: "column", gap: 8 } },
        h(
          "div",
          null,
          tx("Session in progress ({0}): {1}/{2}", [kindLabel(saved.kind), Math.min(saved.idx + 1, saved.items.length), saved.items.length])
        ),
        h(
          "div",
          { style: { display: "flex", gap: 8 } },
          h("button", { onClick: resume, disabled: busy, style: primary }, tx("Continue where I left off")),
          h("button", { onClick: discardSaved, style: tabOff }, tx("Discard"))
        )
      )
    : null;

  const targetList = h(
    "div",
    { style: { ...field, maxHeight: 180, overflow: "auto", display: "flex", flexDirection: "column", gap: 6 } },
    playlists.map((p) =>
      h(
        "label",
        { key: p.id, style: { display: "flex", gap: 8, cursor: "pointer" } },
        h("input", {
          type: "checkbox",
          checked: targets.includes(p.id),
          onChange: () =>
            setTargets((t) => (t.includes(p.id) ? t.filter((x) => x !== p.id) : [...t, p.id])),
        }),
        p.name
      )
    )
  );

  const createRow = h(
    "div",
    { style: { display: "flex", gap: 8 } },
    h("input", {
      type: "text",
      value: newPlName,
      placeholder: tx("New playlist name"),
      onChange: (e) => setNewPlName(e.target.value),
      style: { ...field, flex: 1 },
    }),
    h("button", { onClick: createAndSelect, disabled: busy || !newPlName.trim(), style: tabOff }, tx("＋ Create"))
  );
  const targetPicker = h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, createRow, targetList);

  const queueBox = h(
    "label",
    { key: "qb", style: { display: "flex", gap: 8, cursor: "pointer" } },
    h("input", { type: "checkbox", checked: useQueue, onChange: () => setUseQueue((v) => !v) }),
    tx("Show a Queue button")
  );

  const playlistSelect = h(
    "select",
    { value: sourceId, onChange: (e) => setSourceId(e.target.value), style: field },
    playlists.map((p) => h("option", { key: p.id, value: p.id }, p.name))
  );

  const optionalSelect = (value, setValue, none) =>
    h(
      "select",
      { value, onChange: (e) => setValue(e.target.value), style: field },
      h("option", { value: "" }, none),
      playlists.map((p) => h("option", { key: p.id, value: p.id }, p.name))
    );

  const maybePicker = [
    h("div", { key: "mt" }, tx("Playlist for the \"Maybe\" button (optional):")),
    h("div", { key: "ms" }, optionalSelect(maybeId, setMaybeId, tx("No Maybe button"))),
  ];

  const label = (idle) => (busy ? loadMsg || tx("Loading...") : idle);
  let body;

  if (mode === "add") {
    body = [
      h("p", { key: "p" }, tx("Paste the songs (one per line or separated by ;). E.g.: Blinding Lights - The Weeknd")),
      h("textarea", { key: "t", rows: 10, value: text, onChange: (e) => setText(e.target.value), style: field }),
      h("div", { key: "ft" }, tx("Or load a .txt or .csv file:")),
      h("input", { key: "fi", type: "file", accept: ".txt,.csv", onChange: onFile, style: field }),
      h("div", { key: "d" }, tx("Destination playlist(s) (check one or more):")),
      h("div", { key: "pk" }, targetPicker),
      ...maybePicker,
      queueBox,
      h(
        "button",
        { key: "b", onClick: startAdd, disabled: busy || !text.trim() || !targets.length, style: primary },
        label(tx("Start"))
      ),
    ];
  } else if (mode === "link") {
    body = [
      h("p", { key: "p" }, tx("Paste the link of a public playlist (yours or someone else's) and send the good songs to yours.")),
      h("input", {
        key: "l",
        type: "text",
        value: linkText,
        placeholder: "https://open.spotify.com/playlist/...",
        onChange: (e) => setLinkText(e.target.value),
        style: field,
      }),
      h("div", { key: "d" }, tx("Destination playlist(s) (check one or more):")),
      h("div", { key: "pk" }, targetPicker),
      ...maybePicker,
      queueBox,
      h(
        "button",
        { key: "b", onClick: startLink, disabled: busy || !linkText.trim() || !targets.length, style: primary },
        label(tx("Load playlist and start"))
      ),
    ];
  } else if (mode === "liked") {
    body = [
      h("p", { key: "p" }, tx("Go through your Liked Songs (most recent first) and send each one to the right playlist.")),
      h("div", { key: "n" }, tx("How many songs to load (0 = all):")),
      h("input", {
        key: "i",
        type: "number",
        min: 0,
        value: likedCount,
        onChange: (e) => setLikedCount(e.target.value),
        style: field,
      }),
      h("div", { key: "d" }, tx("Destination playlist(s) (check one or more):")),
      h("div", { key: "pk" }, targetPicker),
      ...maybePicker,
      queueBox,
      h(
        "button",
        { key: "b", onClick: startLiked, disabled: busy || !targets.length, style: primary },
        label(tx("Load liked songs and start"))
      ),
    ];
  } else if (mode === "clean") {
    body = [
      h("p", { key: "p" }, tx("Listen to the songs already in a playlist: ✓ keeps, ✕ removes and ➜ moves to another playlist.")),
      h("div", { key: "d" }, tx("Playlist to clean:")),
      h("div", { key: "s" }, playlistSelect),
      h("div", { key: "mt" }, tx("Playlist for the \"Move\" button (optional):")),
      h("div", { key: "ms" }, optionalSelect(moveToId, setMoveToId, tx("No Move button"))),
      h(
        "button",
        { key: "b", onClick: startClean, disabled: busy || !sourceId, style: primary },
        label(tx("Start cleaning"))
      ),
    ];
  } else if (mode === "discover") {
    const optBox = (k, txt) =>
      h(
        "label",
        { key: k, style: { display: "flex", gap: 8, cursor: "pointer" } },
        h("input", {
          type: "checkbox",
          checked: discOpts[k],
          onChange: () => setDiscOpts((o) => ({ ...o, [k]: !o[k] })),
        }),
        txt
      );
    body = [
      h(
        "p",
        { key: "p" },
        tx("Reads the playlist's name and description (bio), searches for songs with those terms and you approve them one by one. Approved ones go to that same playlist.")
      ),
      h("div", { key: "d" }, "Playlist:"),
      h("div", { key: "s" }, playlistSelect),
      h(
        "button",
        { key: "b0", onClick: loadBio, disabled: busy || !sourceId, style: tabOff },
        tx("Read the playlist bio")
      ),
      bio
        ? h(
            "div",
            { key: "bio", style: { ...field } },
            h("strong", null, bio.name),
            h("div", { style: { opacity: 0.7, marginTop: 4 } }, bio.description || tx("(the playlist has no description)"))
          )
        : null,
      h("div", { key: "tt" }, tx("Search terms (one per line, edit freely):")),
      h("textarea", {
        key: "ta",
        rows: 6,
        value: discTerms,
        placeholder: tx("E.g.: 80s rock\nworkout songs"),
        onChange: (e) => setDiscTerms(e.target.value),
        style: field,
      }),
      h("div", { key: "cn" }, tx("How many new songs do you want to see?")),
      h("input", {
        key: "ci",
        type: "number",
        min: 1,
        value: discCount,
        onChange: (e) => setDiscCount(e.target.value),
        style: field,
      }),
      optBox("tracks", tx("Search songs with these terms")),
      optBox("playlists", tx("Also search similar public playlists")),
      optBox("artists", tx("Include more songs from the artists already in the playlist")),
      h(
        "label",
        { key: "other", style: { display: "flex", gap: 8, cursor: "pointer" } },
        h("input", { type: "checkbox", checked: discOther, onChange: () => setDiscOther((v) => !v) }),
        tx("Send the approved songs to another playlist")
      ),
      discOther ? h("div", { key: "dpk" }, targetPicker) : null,
      ...maybePicker,
      queueBox,
      h(
        "button",
        { key: "go", onClick: startDiscover, disabled: busy || !sourceId || !discTerms.trim(), style: primary },
        label(tx("Search and start"))
      ),
    ];
  } else if (mode === "diag") {
    body = [
      h("p", { key: "p" }, tx("Tests what works on your Spotify. If something fails, copy the result and send it with your bug report.")),
      h("div", { key: "d" }, tx("Playlist to test:")),
      h("div", { key: "s" }, playlistSelect),
      h(
        "button",
        { key: "b", onClick: doDiag, disabled: busy || !sourceId, style: primary },
        label(tx("Run diagnostics"))
      ),
      h(
        "button",
        { key: "b2", onClick: doWriteTest, disabled: busy || !sourceId, style: tabOff },
        tx("Test writing (adds 1 test song and removes it right after)")
      ),
      diagOut
        ? h(
            "div",
            { key: "o" },
            h("textarea", { readOnly: true, rows: 14, value: diagOut, style: field }),
            h("button", { onClick: () => copyText(diagOut), style: { ...primary, marginTop: 8 } }, tx("Copy result"))
          )
        : null,
    ];
  } else if (mode === "dupes") {
    const extras = scanResults
      ? scanResults.reduce((a, r) => a + Object.values(r.where).reduce((x, c) => x + (c - 1), 0), 0)
      : 0;
    const globalExtra = scanResults
      ? scanResults.reduce((a, r) => a + Object.values(r.where).reduce((x, c) => x + c, 0) - 1, 0)
      : 0;
    const confirming = (m) => confirmRemove && removeMode === m;
    body = [
      h("div", { key: "d" }, "Playlist:"),
      h("div", { key: "s" }, playlistSelect),
      h(
        "button",
        {
          key: "b1",
          onClick: () => runScan(playlists.filter((p) => p.id === sourceId), nameOf(sourceId), sourceId),
          disabled: busy || !sourceId,
          style: primary,
        },
        tx("Search this playlist")
      ),
      h(
        "button",
        {
          key: "b2",
          onClick: () => runScan(playlists, tx("all playlists"), null),
          disabled: busy || !playlists.length,
          style: primary,
        },
        tx("Search all playlists")
      ),
      busy ? h("div", { key: "m" }, loadMsg || tx("Scanning...")) : null,
      removeMsg ? h("div", { key: "rm" }, removeMsg) : null,
      scanResults
        ? h(
            "div",
            { key: "r" },
            h("h2", null, tx("{0} duplicate(s) in {1}", [scanResults.length, scanTitle])),
            scanResults.length
              ? h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: 8, margin: "8px 0" } },
                  extras > 0
                    ? h(
                        "button",
                        {
                          onClick: () => doRemove("within"),
                          disabled: busy,
                          style: confirming("within") ? pill(BAD, false) : tabOff,
                        },
                        confirming("within")
                          ? tx("Confirm: remove {0} duplicate(s)", [extras])
                          : scanId
                          ? tx("Remove all duplicates (keeps 1 of each)")
                          : tx("Remove duplicates within each playlist")
                      )
                    : null,
                  !scanId
                    ? h(
                        "button",
                        {
                          onClick: () => doRemove("global"),
                          disabled: busy,
                          style: confirming("global") ? pill(BAD, false) : tabOff,
                        },
                        confirming("global")
                          ? tx("Confirm: remove {0} copy(ies) and keep only 1 of each song", [globalExtra])
                          : tx("Remove all (keeps only 1 copy of each song)")
                      )
                    : null
                )
              : null,
            scanResults.length
              ? h(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: 10, marginTop: 12 } },
                  scanResults.map((r) =>
                    h(
                      "div",
                      { key: r.key },
                      h("strong", null, r.label),
                      Object.entries(r.where).map(([id, c]) =>
                        h(
                          "div",
                          { key: id, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 } },
                          h("span", { style: { opacity: 0.7, flex: 1 } }, c > 1 ? `${nameOf(id)} (${c}x)` : nameOf(id)),
                          h(
                            "button",
                            {
                              onClick: () => removeOne(r, id, c),
                              disabled: busy,
                              style: { ...pill(BAD, busy), padding: "4px 12px" },
                            },
                            c > 1 ? tx("Remove duplicate") : tx("Take out of here")
                          )
                        )
                      )
                    )
                  )
                )
              : h("div", null, tx("No duplicate songs 🎉"))
          )
        : null,
    ];
  } else {
    // tools: export and unavailable songs
    let out = null;
    if (toolOut?.type === "export") {
      const fileName = `${(toolOut.name || "playlist").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
      out = h(
        "div",
        { key: "out" },
        h("div", null, tx("{0} song(s). Copy or download (format Song - Artist):", [toolOut.count])),
        h("textarea", { readOnly: true, rows: 12, value: toolOut.text, style: { ...field, marginTop: 8 } }),
        h(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 8 } },
          h("button", { onClick: () => copyText(toolOut.text), style: primary }, tx("Copy")),
          h("button", { onClick: () => downloadText(fileName, toolOut.text), style: tabOff }, tx("Download .txt"))
        )
      );
    } else if (toolOut?.type === "unavail") {
      out = h(
        "div",
        { key: "out" },
        h("h2", null, tx("{0} unavailable", [toolOut.bad.length])),
        toolOut.nulls
          ? h(
              "div",
              { style: { opacity: 0.7, fontSize: 13 } },
              tx("There are also {0} item(s) deleted from Spotify that the API won't let me remove; remove them in the app.", [toolOut.nulls])
            )
          : null,
        toolOut.bad.length
          ? h(
              "button",
              { onClick: removeAllBad, disabled: busy, style: confirmTool ? pill(BAD, false) : tabOff },
              confirmTool ? tx("Confirm: remove {0}", [toolOut.bad.length]) : tx("Remove all unavailable songs")
            )
          : h("div", null, tx("No unavailable songs 🎉")),
        h(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 12 } },
          toolOut.bad.map((b, i) =>
            h(
              "div",
              { key: `${b.uri}-${i}`, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13 } },
              h("span", { style: { flex: 1 } }, b.label),
              h(
                "button",
                {
                  onClick: () => removeBad([b.uri]),
                  disabled: busy,
                  style: { ...pill(BAD, busy), padding: "4px 12px" },
                },
                tx("Remove")
              )
            )
          )
        )
      );
    }
    const section = (key, title, ...children) =>
      h("div", { key, style: { ...field, display: "flex", flexDirection: "column", gap: 8 } }, h("strong", null, title), ...children);
    const sortOptions = [
      ["title", "Title (A–Z)"],
      ["artist", "Artist (A–Z)"],
      ["album", "Album (A–Z)"],
      ["added-new", "Date added (newest first)"],
      ["added-old", "Date added (oldest first)"],
      ["random", "Random"],
    ];
    const toolSections = [
      section(
        "sort",
        tx("Sort a playlist into a new playlist"),
        h("small", null, tx("The original playlist is not changed; a sorted copy is created.")),
        h(
          "select",
          { value: sortBy, onChange: (e) => setSortBy(e.target.value), style: field },
          sortOptions.map(([v, l]) => h("option", { key: v, value: v }, tx(l)))
        ),
        h("input", {
          type: "text",
          value: sortName,
          placeholder: tx("Name of the sorted playlist"),
          onChange: (e) => setSortName(e.target.value),
          style: field,
        }),
        h("button", { onClick: doSort, disabled: busy || !sourceId, style: primary }, tx("Create sorted copy"))
      ),
      section(
        "find",
        tx("Where is this song?"),
        h("input", {
          type: "text",
          value: findQuery,
          placeholder: tx("Type part of the title or artist"),
          onChange: (e) => setFindQuery(e.target.value),
          style: field,
        }),
        h("button", { onClick: doFind, disabled: busy || !findQuery.trim(), style: primary }, tx("Search all my playlists")),
        findResults
          ? h(
              "div",
              null,
              h("div", { style: { marginBottom: 6 } }, findResults.length ? tx("{0} song(s) found", [findResults.length]) : tx("No song found with that text")),
              findResults.map((r) =>
                h(
                  "div",
                  { key: r.key, style: { marginBottom: 8 } },
                  h("strong", null, r.label),
                  Object.entries(r.where).map(([id, c]) =>
                    h(
                      "div",
                      { key: id, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 4 } },
                      h("span", { style: { opacity: 0.7, flex: 1 } }, c > 1 ? `${nameOf(id)} (${c}x)` : nameOf(id)),
                      h(
                        "button",
                        {
                          onClick: () => removeFound(r, id),
                          disabled: busy,
                          style: { ...pill(BAD, busy), padding: "4px 12px" },
                        },
                        tx("Take out of here")
                      )
                    )
                  )
                )
              )
            )
          : null
      ),
      section(
        "backup",
        tx("Backup and restore"),
        h("button", { onClick: doBackup, disabled: busy || !playlists.length, style: primary }, tx("Back up all my playlists")),
        backupData
          ? h(
              "div",
              null,
              h("div", null, tx("Backup ready: {0} playlist(s), {1} song(s), about {2} KB.", [backupData.n, backupData.m, backupData.kb])),
              h(
                "div",
                { style: { display: "flex", gap: 8, marginTop: 8 } },
                h("button", { onClick: () => copyText(backupData.text), style: primary }, tx("Copy backup")),
                h("button", { onClick: () => downloadText("swipe-playlist-backup.json", backupData.text), style: tabOff }, tx("Download .json"))
              )
            )
          : null,
        h("div", null, tx("Restore from a backup file (.json):")),
        h("input", { type: "file", accept: ".json", onChange: onRestoreFile, style: field }),
        restoreData
          ? h(
              "div",
              null,
              h("div", { style: { marginBottom: 6 } }, tx("Playlists in the backup (restored as new playlists):")),
              restoreData.playlists.map((p, i) =>
                h(
                  "label",
                  { key: i, style: { display: "flex", gap: 8, cursor: "pointer" } },
                  h("input", {
                    type: "checkbox",
                    checked: !!restoreSel[i],
                    onChange: () => setRestoreSel((o) => ({ ...o, [i]: !o[i] })),
                  }),
                  tx("{0} ({1} songs)", [p.name, (p.tracks || []).length])
                )
              ),
              h("button", { onClick: doRestore, disabled: busy, style: { ...primary, marginTop: 8 } }, tx("Restore selected"))
            )
          : null
      ),
      toolMsg ? h("div", { key: "tm" }, toolMsg) : null,
    ];
    body = [
      h("div", { key: "d" }, "Playlist:"),
      h("div", { key: "s" }, playlistSelect),
      h(
        "div",
        { key: "row", style: { display: "flex", gap: 8, flexWrap: "wrap" } },
        h("button", { onClick: doExport, disabled: busy || !sourceId, style: primary }, tx("Export to text")),
        h("button", { onClick: doUnavail, disabled: busy || !sourceId, style: primary }, tx("Find unavailable songs"))
      ),
      busy ? h("div", { key: "m" }, loadMsg || tx("Loading...")) : null,
      out,
      ...toolSections,
    ];
  }

  const plStatus = loadingPl
    ? h("div", null, tx("Loading your playlists..."))
    : !playlists.length
    ? h(
        "div",
        { style: { ...field, display: "flex", flexDirection: "column", gap: 8 } },
        h("div", null, tx("⚠ Could not load your playlists. {0}", [plError])),
        h("button", { onClick: reloadPlaylists, style: tabOff }, tx("Try again")),
        h("div", null, tx("Or add a playlist by link:")),
        h("input", {
          type: "text",
          value: manualLink,
          placeholder: "https://open.spotify.com/playlist/...",
          onChange: (e) => setManualLink(e.target.value),
          style: field,
        }),
        h("button", { onClick: addManual, disabled: !manualLink.trim(), style: primary }, tx("Add by link"))
      )
    : null;

  const busyBar = busy
    ? h(
        "div",
        { style: { ...field, display: "flex", gap: 8, alignItems: "center" } },
        h("span", { style: { flex: 1 } }, loadMsg || tx("Working...")),
        h(
          "button",
          {
            onClick: () => {
              STOP = true;
            },
            style: tabOff,
          },
          tx("Cancel")
        )
      )
    : null;

  const langSelect = h(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 8 } },
    h("span", null, tx("Language:")),
    h(
      "select",
      {
        value: langPref,
        onChange: (e) => {
          try {
            localStorage.setItem(LANG_KEY, e.target.value);
          } catch (err) {}
          setLangPref(e.target.value);
        },
        style: { ...field, width: "auto" },
      },
      h("option", { value: "auto" }, `${tx("Automatic (system / Spotify)")} — ${LANGS[detectLang()]}`),
      Object.entries(LANGS).map(([c, n]) => h("option", { key: c, value: c }, n))
    )
  );

  return h(
    "div",
    { style: page },
    h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 } }, h("h1", null, "Swipe Playlist"), langSelect),
    savedBanner,
    tabs,
    plStatus,
    busyBar,
    ...body
  );
}

function render() {
  return h(App);
}
