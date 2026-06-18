// api/api-testsnapshot.js
import { getSleeperBaseData, getSleeperWeeklyState, buildLeagueSnapshot } from '../utils/leagueState.js';

export default async function handler(req, res) {
  // Enforce GET requests for testing state structures
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Fallback testing targets if explicit query strings aren't passed
  const leagueId = req.query.leagueId || '112233445566778899'; 
  const targetWeek = parseInt(req.query.week, 10) || 14; 
  const isHistorical = req.query.historical === 'true';

  try {
    // Optimization: If processing a closed historical year, skip heavy API processing loops
    if (isHistorical) {
      return res.status(200).json({
        message: 'Static context returned for historical records.',
        timestamp: new Date().toISOString(),
        snapshot: {
          note: "Archived static snapshots are served directly without remote API polling overhead."
        }
      });
    }

    // Step 1: Concurrent core data extraction
    const baseData = await getSleeperBaseData(leagueId);

    // Step 2: Dynamic time-series score tracking 
    const matchupAggregates = await getSleeperWeeklyState(leagueId, targetWeek);

    // Step 3: Synthesis and formatting
    const structuralSnapshot = buildLeagueSnapshot({
      ...baseData,
      matchupAggregates
    });

    return res.status(200).json({
      success: true,
      executionTime: new Date().toISOString(),
      payload: structuralSnapshot
    });

  } catch (error) {
    console.error('API Test Snapshot Generation Failure:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to synthesize league snapshot format.',
      details: error.message
    });
  }
}
