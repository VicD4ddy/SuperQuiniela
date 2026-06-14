const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// 1. Cargar variables de entorno manualmente desde .env.local
const envPath = path.join(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const index = trimmed.indexOf('=');
      if (index !== -1) {
        const key = trimmed.substring(0, index).trim();
        const val = trimmed.substring(index + 1).trim();
        let finalVal = val;
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          finalVal = val.substring(1, val.length - 1);
        }
        process.env[key] = finalVal;
      }
    }
  });
}

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!RAPIDAPI_KEY || !RAPIDAPI_HOST || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Variables de entorno no configuradas en .env.local');
  process.exit(1);
}

// Inicializar cliente de Supabase con privilegios admin
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 2. Mapeador de Equipos (Inglés de RapidAPI -> Código FIFA del Mundial 2026)
const NAME_MAP = {
  "germany": "GER",
  "curacao": "CUW",
  "curaçao": "CUW",
  "mexico": "MEX",
  "south africa": "RSA",
  "south korea": "KOR",
  "czech republic": "CZE",
  "czechia": "CZE",
  "chequia": "CZE",
  "czech rep.": "CZE",
  "canada": "CAN",
  "bosnia and herzegovina": "BIH",
  "bosnia-herzegovina": "BIH",
  "bosnia & herzegovina": "BIH",
  "bosnia y herz.": "BIH",
  "bosnia": "BIH",
  "qatar": "QAT",
  "switzerland": "SUI",
  "brazil": "BRA",
  "morocco": "MAR",
  "haiti": "HAI",
  "scotland": "SCO",
  "united states": "USA",
  "usa": "USA",
  "united states of america": "USA",
  "paraguay": "PAR",
  "australia": "AUS",
  "turkey": "TUR",
  "turquía": "TUR",
  "ivory coast": "CIV",
  "cote d'ivoire": "CIV",
  "côte d'ivoire": "CIV",
  "ecuador": "ECU",
  "netherlands": "NED",
  "holland": "NED",
  "países bajos": "NED",
  "japan": "JPN",
  "japón": "JPN",
  "sweden": "SWE",
  "suecia": "SWE",
  "tunisia": "TUN",
  "túnez": "TUN",
  "belgium": "BEL",
  "bélgica": "BEL",
  "egypt": "EGY",
  "egipto": "EGY",
  "iran": "IRN",
  "irán": "IRN",
  "new zealand": "NZL",
  "nueva zelanda": "NZL",
  "spain": "ESP",
  "españa": "ESP",
  "cape verde": "CPV",
  "cabo verde": "CPV",
  "saudi arabia": "KSA",
  "arabia saudita": "KSA",
  "uruguay": "URU",
  "france": "FRA",
  "francia": "FRA",
  "senegal": "SEN",
  "iraq": "IRQ",
  "irak": "IRQ",
  "norway": "NOR",
  "noruega": "NOR",
  "argentina": "ARG",
  "algeria": "ALG",
  "argelia": "ALG",
  "austria": "AUT",
  "jordan": "JOR",
  "jordania": "JOR",
  "portugal": "POR",
  "dr congo": "COD",
  "democratic republic of the congo": "COD",
  "congo dr": "COD",
  "congo": "COD",
  "r.d. congo": "COD",
  "uzbekistan": "UZB",
  "uzbekistán": "UZB",
  "colombia": "COL",
  "england": "ENG",
  "inglaterra": "ENG",
  "croatia": "CRO",
  "croacia": "CRO",
  "ghana": "GHA",
  "panama": "PAN",
  "panamá": "PAN"
};

// Fixture estático
const GROUPS = {
  A: ["MEX", "RSA", "KOR", "CZE"],
  B: ["CAN", "BIH", "QAT", "SUI"],
  C: ["BRA", "MAR", "HAI", "SCO"],
  D: ["USA", "PAR", "AUS", "TUR"],
  E: ["GER", "CUW", "CIV", "ECU"],
  F: ["NED", "JPN", "SWE", "TUN"],
  G: ["BEL", "EGY", "IRN", "NZL"],
  H: ["ESP", "CPV", "KSA", "URU"],
  I: ["FRA", "SEN", "IRQ", "NOR"],
  J: ["ARG", "ALG", "AUT", "JOR"],
  K: ["POR", "COD", "UZB", "COL"],
  L: ["ENG", "CRO", "GHA", "PAN"],
};

const ALL_GROUP_MATCHES = [];
for (const [group, teams] of Object.entries(GROUPS)) {
  const [t1, t2, t3, t4] = teams;
  ALL_GROUP_MATCHES.push(
    { id: `${group}-1`, group, matchday: 1, homeTeam: t1, awayTeam: t2 },
    { id: `${group}-2`, group, matchday: 1, homeTeam: t3, awayTeam: t4 },
    { id: `${group}-3`, group, matchday: 2, homeTeam: t1, awayTeam: t3 },
    { id: `${group}-4`, group, matchday: 2, homeTeam: t4, awayTeam: t2 },
    { id: `${group}-5`, group, matchday: 3, homeTeam: t4, awayTeam: t1 },
    { id: `${group}-6`, group, matchday: 3, homeTeam: t2, awayTeam: t3 }
  );
}

const THIRD_PLACE_SLOTS = [
  { matchId: "M74", allowedGroups: ["A", "B", "C", "D", "F"] },
  { matchId: "M77", allowedGroups: ["C", "D", "F", "G", "H"] },
  { matchId: "M79", allowedGroups: ["C", "E", "F", "H", "I"] },
  { matchId: "M80", allowedGroups: ["E", "H", "I", "J", "K"] },
  { matchId: "M81", allowedGroups: ["B", "E", "F", "I", "J"] },
  { matchId: "M82", allowedGroups: ["A", "E", "H", "I", "J"] },
  { matchId: "M85", allowedGroups: ["E", "F", "G", "I", "J"] },
  { matchId: "M87", allowedGroups: ["D", "E", "I", "J", "L"] },
];

const R32_MATCHES = [
  { id: "M74", round: "R32", homeSlot: "1E", awaySlot: "3RD" },
  { id: "M77", round: "R32", homeSlot: "1I", awaySlot: "3RD" },
  { id: "M73", round: "R32", homeSlot: "2A", awaySlot: "2B" },
  { id: "M75", round: "R32", homeSlot: "1F", awaySlot: "2C" },
  { id: "M83", round: "R32", homeSlot: "2K", awaySlot: "2L" },
  { id: "M84", round: "R32", homeSlot: "1H", awaySlot: "2J" },
  { id: "M81", round: "R32", homeSlot: "1D", awaySlot: "3RD" },
  { id: "M82", round: "R32", homeSlot: "1G", awaySlot: "3RD" },
  { id: "M76", round: "R32", homeSlot: "1C", awaySlot: "2F" },
  { id: "M78", round: "R32", homeSlot: "2E", awaySlot: "2I" },
  { id: "M79", round: "R32", homeSlot: "1A", awaySlot: "3RD" },
  { id: "M80", round: "R32", homeSlot: "1L", awaySlot: "3RD" },
  { id: "M86", round: "R32", homeSlot: "1J", awaySlot: "2H" },
  { id: "M88", round: "R32", homeSlot: "2D", awaySlot: "2G" },
  { id: "M85", round: "R32", homeSlot: "1B", awaySlot: "3RD" },
  { id: "M87", round: "R32", homeSlot: "1K", awaySlot: "3RD" },
];

const R16_MATCHES = [
  { id: "M89", round: "R16", homeSlot: "W_M74", awaySlot: "W_M77" },
  { id: "M90", round: "R16", homeSlot: "W_M73", awaySlot: "W_M75" },
  { id: "M91", round: "R16", homeSlot: "W_M83", awaySlot: "W_M84" },
  { id: "M92", round: "R16", homeSlot: "W_M81", awaySlot: "W_M82" },
  { id: "M93", round: "R16", homeSlot: "W_M76", awaySlot: "W_M78" },
  { id: "M94", round: "R16", homeSlot: "W_M79", awaySlot: "W_M80" },
  { id: "M95", round: "R16", homeSlot: "W_M86", awaySlot: "W_M88" },
  { id: "M96", round: "R16", homeSlot: "W_M85", awaySlot: "W_M87" },
];

const QF_MATCHES = [
  { id: "M97", round: "QF", homeSlot: "W_M89", awaySlot: "W_M90" },
  { id: "M98", round: "QF", homeSlot: "W_M91", awaySlot: "W_M92" },
  { id: "M99", round: "QF", homeSlot: "W_M93", awaySlot: "W_M94" },
  { id: "M100", round: "QF", homeSlot: "W_M95", awaySlot: "W_M96" },
];

const SF_MATCHES = [
  { id: "M101", round: "SF", homeSlot: "W_M97", awaySlot: "W_M98" },
  { id: "M102", round: "SF", homeSlot: "W_M99", awaySlot: "W_M100" },
];

const FINAL_MATCHES = [
  { id: "M103", round: "3RD", homeSlot: "L_M101", awaySlot: "L_M102" },
  { id: "M104", round: "FINAL", homeSlot: "W_M101", awaySlot: "W_M102" },
];

const ALL_KNOCKOUT_MATCHES = [
  ...R32_MATCHES,
  ...R16_MATCHES,
  ...QF_MATCHES,
  ...SF_MATCHES,
  ...FINAL_MATCHES,
];

// Cálculo de tabla de posiciones de grupos (criterios FIFA)
function calculateGroupStandings(group, matchesMap) {
  const teams = GROUPS[group];
  const groupMatches = ALL_GROUP_MATCHES.filter(m => m.group === group);
  
  const rows = {};
  for (const code of teams) {
    rows[code] = {
      teamCode: code,
      played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0
    };
  }

  for (const match of groupMatches) {
    const om = matchesMap[match.id];
    if (!om || om.home_goals === null || om.away_goals === null) continue;

    const h = om.home_goals;
    const a = om.away_goals;
    const home = rows[match.homeTeam];
    const away = rows[match.awayTeam];

    home.played++;
    away.played++;
    home.goalsFor += h;
    home.goalsAgainst += a;
    away.goalsFor += a;
    away.goalsAgainst += h;

    if (h > a) {
      home.won++;
      home.points += 3;
      away.lost++;
    } else if (h < a) {
      away.won++;
      away.points += 3;
      home.lost++;
    } else {
      home.drawn++;
      away.drawn++;
      home.points += 1;
      away.points += 1;
    }
  }

  for (const code of teams) {
    rows[code].goalDiff = rows[code].goalsFor - rows[code].goalsAgainst;
  }

  return Object.values(rows).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.teamCode.localeCompare(b.teamCode);
  });
}

// Obtener ganadores y segundos de grupo
function getGroupResults(matchesMap) {
  const results = {};
  for (const group of Object.keys(GROUPS)) {
    const standings = calculateGroupStandings(group, matchesMap);
    results[group] = {
      first: standings[0]?.teamCode ?? "",
      second: standings[1]?.teamCode ?? "",
      third: standings[2] ?? { teamCode: "" }
    };
  }
  return results;
}

// Asignar terceros
function assignThirdPlaceTeams(groupResults) {
  const allThirds = Object.entries(groupResults)
    .map(([group, result]) => ({
      group,
      ...result.third,
    }))
    .filter((t) => t.teamCode !== "");

  allThirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.group.localeCompare(b.group);
  });

  const qualifyingThirds = allThirds.slice(0, 8);
  const qualifyingGroups = new Set(qualifyingThirds.map((t) => t.group));

  const assignment = {};
  const usedGroups = new Set();

  function backtrack(slotIndex) {
    if (slotIndex >= THIRD_PLACE_SLOTS.length) return true;

    const slot = THIRD_PLACE_SLOTS[slotIndex];
    for (const group of slot.allowedGroups) {
      if (qualifyingGroups.has(group) && !usedGroups.has(group)) {
        usedGroups.add(group);
        const third = qualifyingThirds.find((t) => t.group === group);
        if (third) {
          assignment[slot.matchId] = third.teamCode;
          if (backtrack(slotIndex + 1)) return true;
          delete assignment[slot.matchId];
        }
        usedGroups.delete(group);
      }
    }
    return false;
  }

  backtrack(0);
  return assignment;
}

// Resolver bracket completo
function resolveKnockoutBracket(groupResults, matchesMap) {
  const thirdAssignments = assignThirdPlaceTeams(groupResults);
  const resolved = {};
  const winners = {};

  function resolveSlot(slot, matchId) {
    if (slot.startsWith("1")) {
      const group = slot[1];
      return groupResults[group]?.first ?? "";
    }
    if (slot.startsWith("2")) {
      const group = slot[1];
      return groupResults[group]?.second ?? "";
    }
    if (slot === "3RD" && matchId) {
      return thirdAssignments[matchId] ?? "";
    }
    if (slot.startsWith("W_")) {
      return winners[slot.substring(2)] ?? "";
    }
    if (slot.startsWith("L_")) {
      const prevMatchId = slot.substring(2);
      const prevResolved = resolved[prevMatchId];
      const prevWinner = winners[prevMatchId];
      if (prevResolved && prevWinner) {
        return prevResolved.home === prevWinner ? prevResolved.away : prevResolved.home;
      }
      return "";
    }
    return "";
  }

  // R32
  for (const match of R32_MATCHES) {
    const home = resolveSlot(match.homeSlot, match.id);
    const away = resolveSlot(match.awaySlot, match.id);
    resolved[match.id] = { home, away };

    const om = matchesMap[match.id];
    if (om && om.home_goals !== null && om.away_goals !== null && home && away) {
      winners[match.id] = om.home_goals >= om.away_goals ? home : away;
    }
  }

  // R16, QF, SF, Finals
  const laterRounds = [...R16_MATCHES, ...QF_MATCHES, ...SF_MATCHES, ...FINAL_MATCHES];
  for (const match of laterRounds) {
    const home = resolveSlot(match.homeSlot);
    const away = resolveSlot(match.awaySlot);
    resolved[match.id] = { home, away };

    const om = matchesMap[match.id];
    if (om && om.home_goals !== null && om.away_goals !== null && home && away) {
      winners[match.id] = om.home_goals >= om.away_goals ? home : away;
    }
  }

  return resolved;
}

// 3. Ejecución de la simulación
async function runSimulation() {
  console.log('\n======================================================');
  console.log('SIMULACIÓN DE ACTUALIZACIÓN AUTOMÁTICA DE PARTIDOS');
  console.log('======================================================\n');

  // a. Descargar de la DB los partidos registrados actualmente
  console.log('Descargando marcadores oficiales actuales de Supabase...');
  const { data: dbMatches, error: dbError } = await supabase
    .from('official_matches')
    .select('*');

  if (dbError) {
    console.error('Error al obtener official_matches de Supabase:', dbError);
    process.exit(1);
  }

  console.log(`Cargados ${dbMatches.length} partidos oficiales de la base de datos.`);
  const dbMatchesMap = {};
  dbMatches.forEach(m => {
    dbMatchesMap[m.match_id] = m;
  });

  // b. Resolver el bracket oficial en base a lo que ya está en la base de datos
  const groupResults = getGroupResults(dbMatchesMap);
  const knockoutBracket = resolveKnockoutBracket(groupResults, dbMatchesMap);

  // c. Consultar a RapidAPI los marcadores en vivo actuales
  const url = `https://${RAPIDAPI_HOST}/football-current-live`;
  console.log(`\nConsultando partidos en vivo en: ${url}...`);

  let apiResponse;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-key': RAPIDAPI_KEY,
        'x-rapidapi-host': RAPIDAPI_HOST
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}`);
    }

    apiResponse = await response.json();
  } catch (error) {
    console.error('Error en la llamada a RapidAPI:', error.message);
    process.exit(1);
  }

  const liveMatches = apiResponse.response?.live || [];
  console.log(`RapidAPI devolvió ${liveMatches.length} partidos en juego actualmente en todo el mundo.\n`);

  // d. Mapear partidos e imprimir resultados
  let matchedCount = 0;
  let unmatchedCount = 0;

  liveMatches.forEach(apiMatch => {
    const homeName = apiMatch.home?.name;
    const awayName = apiMatch.away?.name;
    
    if (!homeName || !awayName) return;

    const homeCode = NAME_MAP[homeName.toLowerCase().trim()];
    const awayCode = NAME_MAP[awayName.toLowerCase().trim()];

    // Si ambos equipos están en el mapa, es un partido potencial del mundial
    if (homeCode && awayCode) {
      // Intentar buscar en la fase de grupos
      let matchedId = null;
      let matchedType = '';

      const groupMatch = ALL_GROUP_MATCHES.find(m => 
        (m.homeTeam === homeCode && m.awayTeam === awayCode) ||
        (m.homeTeam === awayCode && m.awayTeam === homeCode)
      );

      if (groupMatch) {
        matchedId = groupMatch.id;
        matchedType = 'Fase de Grupos';
      } else {
        // Buscar en eliminatorias resueltas
        const knockoutMatchId = Object.keys(knockoutBracket).find(id => {
          const slotTeams = knockoutBracket[id];
          return slotTeams && (
            (slotTeams.home === homeCode && slotTeams.away === awayCode) ||
            (slotTeams.home === awayCode && slotTeams.away === homeCode)
          );
        });

        if (knockoutMatchId) {
          matchedId = knockoutMatchId;
          matchedType = 'Eliminatorias';
        }
      }

      if (matchedId) {
        matchedCount++;
        const dbMatch = dbMatchesMap[matchedId];
        const apiHomeScore = apiMatch.home.score;
        const apiAwayScore = apiMatch.away.score;
        const apiFinished = apiMatch.status?.finished || false;

        // Determinar si hay un cambio con respecto a la base de datos
        const hasChanges = !dbMatch || 
          dbMatch.home_goals !== apiHomeScore || 
          dbMatch.away_goals !== apiAwayScore ||
          dbMatch.is_completed !== apiFinished;

        console.log(`[PARTIDO DETECTADO] ID: ${matchedId} (${matchedType})`);
        console.log(`  ${homeName} (${homeCode}) vs ${awayName} (${awayCode})`);
        console.log(`  Marcador API: ${apiHomeScore} - ${apiAwayScore} (Finalizado: ${apiFinished})`);
        if (dbMatch) {
          console.log(`  Marcador DB:  ${dbMatch.home_goals} - ${dbMatch.away_goals} (Completado: ${dbMatch.is_completed})`);
        } else {
          console.log(`  Marcador DB:  No registrado aún en official_matches`);
        }
        console.log(`  ¿Tiene cambios para actualizar?: ${hasChanges ? 'SÍ 🔴' : 'NO 🟢'}\n`);
      } else {
        unmatchedCount++;
        console.log(`[NO DETECTADO EN FIXTURE] ${homeName} (${homeCode}) vs ${awayName} (${awayCode}) pero son equipos mundialistas.\n`);
      }
    }
  });

  console.log('======================================================');
  console.log(`RESUMEN DE SIMULACIÓN DE PARTIDOS EN VIVO:`);
  console.log(`- Partidos mundialistas emparejados con éxito: ${matchedCount}`);
  console.log(`- Equipos mundialistas detectados en vivo pero sin cruce activo: ${unmatchedCount}`);
  console.log('======================================================\n');

  // e. Correr prueba local simulada con el JSON provisto por el usuario (Alemania vs Curazao)
  console.log('Corriendo test de validación con datos simulados...');
  const mockApiMatch = {
    "id": 4667777,
    "leagueId": 894794,
    "time": "14.06.2026 19:00",
    "home": {
      "id": 8570,
      "score": 6,
      "name": "Germany",
      "longName": "Germany"
    },
    "away": {
      "id": 287981,
      "score": 1,
      "name": "Curacao",
      "longName": "Curacao"
    },
    "status": {
      "finished": false,
      "started": true,
      "ongoing": true,
      "scoreStr": "6 - 1"
    }
  };

  const mockHomeName = mockApiMatch.home.name;
  const mockAwayName = mockApiMatch.away.name;
  const mockHomeCode = NAME_MAP[mockHomeName.toLowerCase().trim()];
  const mockAwayCode = NAME_MAP[mockAwayName.toLowerCase().trim()];

  console.log(`Procesando partido mock: ${mockHomeName} vs ${mockAwayName}...`);
  console.log(`  Códigos traducidos: ${mockHomeCode} vs ${mockAwayCode}`);

  if (mockHomeCode === 'GER' && mockAwayCode === 'CUW') {
    const mockGroupMatch = ALL_GROUP_MATCHES.find(m => 
      (m.homeTeam === mockHomeCode && m.awayTeam === mockAwayCode) ||
      (m.homeTeam === mockAwayCode && m.awayTeam === mockHomeCode)
    );

    if (mockGroupMatch && mockGroupMatch.id === 'E-1') {
      console.log('  ✅ ÉXITO: Mapeo correcto al partido ID "E-1" (Alemania vs Curazao de Fase de Grupos).');
      const dbMatch = dbMatchesMap['E-1'];
      const apiHomeScore = mockApiMatch.home.score;
      const apiAwayScore = mockApiMatch.away.score;
      const apiFinished = mockApiMatch.status.finished;

      const hasChanges = !dbMatch || 
        dbMatch.home_goals !== apiHomeScore || 
        dbMatch.away_goals !== apiAwayScore ||
        dbMatch.is_completed !== apiFinished;

      console.log(`  Marcador en API: ${apiHomeScore} - ${apiAwayScore} (Finalizado: ${apiFinished})`);
      if (dbMatch) {
        console.log(`  Marcador en DB:  ${dbMatch.home_goals} - ${dbMatch.away_goals} (Completado: ${dbMatch.is_completed})`);
      } else {
        console.log(`  Marcador en DB:  No registrado aún`);
      }
      console.log(`  ¿Tiene cambios?: ${hasChanges ? 'SÍ 🔴' : 'NO 🟢'}`);
    } else {
      console.error('  ❌ ERROR: No se mapeó al partido ID "E-1". Mapeado a:', mockGroupMatch);
    }
  } else {
    console.error('  ❌ ERROR: La traducción de Alemania o Curazao falló.');
  }
  console.log('\n======================================================\n');
}

runSimulation();
