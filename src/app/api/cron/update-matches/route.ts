import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calculateUserPoints } from "@/scoringEngine";
import {
  ALL_GROUP_MATCHES,
  getGroupResults,
  resolveKnockoutBracket
} from "@/lib/worldCupData";

export const dynamic = "force-dynamic";

// Traductor de nombres de equipos (Inglés -> Código FIFA)
const NAME_MAP: Record<string, string> = {
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

export async function GET(request: NextRequest) {
  try {
    // 1. Validar el secret de seguridad de Cron
    const { searchParams } = new URL(request.url);
    const secret = searchParams.get("secret");

    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json(
        { success: false, message: "No autorizado: Firma secreta inválida." },
        { status: 401 }
      );
    }

    // 2. Inicializar cliente administrador de Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { success: false, message: "Variables de entorno de base de datos no configuradas." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    // 3. Descargar marcadores oficiales de la DB
    const { data: dbMatches, error: dbError } = await supabase
      .from("official_matches")
      .select("*");

    if (dbError) {
      throw new Error(`Error al leer official_matches: ${dbError.message}`);
    }

    const dbMatchesMap: Record<string, any> = {};
    dbMatches.forEach((m) => {
      dbMatchesMap[m.match_id] = m;
    });

    // 4. Resolver el bracket de eliminatorias basado en marcadores oficiales actuales
    const groupResults = getGroupResults(dbMatchesMap);
    const knockoutBracket = resolveKnockoutBracket(groupResults, dbMatchesMap);

    // 5. Consultar partidos en vivo a RapidAPI
    const rapidapiHost = process.env.RAPIDAPI_HOST;
    const rapidapiKey = process.env.RAPIDAPI_KEY;

    if (!rapidapiHost || !rapidapiKey) {
      return NextResponse.json(
        { success: false, message: "Variables de entorno de RapidAPI no configuradas." },
        { status: 500 }
      );
    }

    const apiResponse = await fetch(`https://${rapidapiHost}/football-current-live`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-key": rapidapiKey,
        "x-rapidapi-host": rapidapiHost
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`Llamada a RapidAPI falló con status HTTP ${apiResponse.status}`);
    }

    const json = await apiResponse.json();
    const liveMatches = json.response?.live || [];

    // 6. Mapear marcadores
    const matchesToUpdate: any[] = [];

    liveMatches.forEach((apiMatch: any) => {
      const homeName = apiMatch.home?.name;
      const awayName = apiMatch.away?.name;

      if (!homeName || !awayName) return;

      const homeCode = NAME_MAP[homeName.toLowerCase().trim()];
      const awayCode = NAME_MAP[awayName.toLowerCase().trim()];

      if (homeCode && awayCode) {
        let matchedId: string | null = null;

        // Intentar en fase de grupos
        const groupMatch = ALL_GROUP_MATCHES.find(
          (m) =>
            (m.homeTeam === homeCode && m.awayTeam === awayCode) ||
            (m.homeTeam === awayCode && m.awayTeam === homeCode)
        );

        if (groupMatch) {
          matchedId = groupMatch.id;
        } else {
          // Intentar en eliminatorias resueltas
          const knockoutMatchId = Object.keys(knockoutBracket).find((id) => {
            const slotTeams = knockoutBracket[id];
            return (
              slotTeams &&
              ((slotTeams.home === homeCode && slotTeams.away === awayCode) ||
                (slotTeams.home === awayCode && slotTeams.away === homeCode))
            );
          });
          if (knockoutMatchId) {
            matchedId = knockoutMatchId;
          }
        }

        if (matchedId) {
          const dbMatch = dbMatchesMap[matchedId];
          const apiHomeScore = apiMatch.home.score;
          const apiAwayScore = apiMatch.away.score;
          const apiFinished = apiMatch.status?.finished || false;

          const hasChanges =
            !dbMatch ||
            dbMatch.home_goals !== apiHomeScore ||
            dbMatch.away_goals !== apiAwayScore ||
            dbMatch.is_completed !== apiFinished;

          if (hasChanges) {
            matchesToUpdate.push({
              match_id: matchedId,
              home_goals: apiHomeScore,
              away_goals: apiAwayScore,
              is_completed: apiFinished
            });
          }
        }
      }
    });

    // 7. Si hay cambios en los partidos, subirlos a base de datos y recalcular perfiles
    let profilesUpdatedCount = 0;

    if (matchesToUpdate.length > 0) {
      const { error: upsertError } = await supabase
        .from("official_matches")
        .upsert(matchesToUpdate);

      if (upsertError) {
        throw new Error(`Error actualizando partidos oficiales: ${upsertError.message}`);
      }

      // Volver a descargar todos los marcadores oficiales actualizados
      const { data: updatedDbMatches, error: refetchError } = await supabase
        .from("official_matches")
        .select("*");

      if (refetchError) {
        throw new Error(`Error al recargar partidos tras la actualización: ${refetchError.message}`);
      }

      // Descargar las quinielas de todos los usuarios
      const { data: quinielasData, error: quinielasError } = await supabase
        .from("user_quinielas")
        .select(`
          user_id,
          predictions,
          knockout_predictions
        `)
        .eq("status", "approved");

      if (quinielasError) {
        throw new Error(`Error descargando perfiles de quinielas: ${quinielasError.message}`);
      }

      if (quinielasData && quinielasData.length > 0) {
        // Calcular puntos para cada participante
        const profilesToUpdate = quinielasData.map((row: any) => {
          const scoring = calculateUserPoints(
            row.predictions || {},
            row.knockout_predictions || {},
            updatedDbMatches || []
          );

          return {
            id: row.user_id,
            total_points: scoring.totalPoints
          };
        });

        // Realizar la actualización masiva de la columna total_points en profiles
        const { error: profilesUpsertError } = await supabase
          .from("profiles")
          .upsert(profilesToUpdate);

        if (profilesUpsertError) {
          throw new Error(`Error actualizando puntajes de perfiles: ${profilesUpsertError.message}`);
        }

        profilesUpdatedCount = profilesToUpdate.length;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Actualización automática completada.`,
      summary: {
        matchesEvaluated: liveMatches.length,
        matchesUpdated: matchesToUpdate.length,
        updatedMatchesList: matchesToUpdate.map((m) => m.match_id),
        userProfilesRecalculated: profilesUpdatedCount
      }
    });

  } catch (error: any) {
    console.error("Error en el cron de actualización de partidos:", error);
    return NextResponse.json(
      { success: false, message: error.message || "Error interno del servidor" },
      { status: 500 }
    );
  }
}
