<script>
	import { round } from '$lib/utils/helper';
	import RecordsAndRankings from './RecordsAndRankings.svelte';

	export let key;
	export let leagueManagerRecords;
	export let leagueTeamManagers;
	export let leagueWeekHighs;
	export let leagueWeekLows;
	export let allTimeBiggestBlowouts;
	export let allTimeClosestMatchups;
	export let mostSeasonLongPoints;
	export let leastSeasonLongPoints;
	export let transactionTotals;

	console.log("🧩 AllTimeRecords props:", {
		transactionTotals,
		allTimeClosestMatchups,
		allTimeBiggestBlowouts,
		leagueManagerRecords,
		leagueWeekHighs,
		leagueWeekLows,
		leagueTeamManagers,
		mostSeasonLongPoints,
		leastSeasonLongPoints,
		key
	});

	let winPercentages = [];
	let lineupIQs = [];
	let fptsHistories = [];
	let tradesData = [];
	let waiversData = [];

	let showTies = false;

	const setRankingsData = (lRR) => {
		winPercentages = [];
		lineupIQs = [];
		fptsHistories = [];
		tradesData = [];
		waiversData = [];
		showTies = false;

		for (const key in lRR) {
			const record = lRR[key];
			const totalGames = record.wins + record.ties + record.losses || 1;

			winPercentages.push({
				managerID: key,
				percentage: round(((record.wins + record.ties / 2) / totalGames) * 100),
				wins: record.wins,
				ties: record.ties,
				losses: record.losses
			});

			const iq = {
				managerID: key,
				fpts: round(record.fptsFor)
			};

			if (record.potentialPoints) {
				iq.iq = round((record.fptsFor / record.potentialPoints) * 100);
				iq.potentialPoints = round(record.potentialPoints);
			}

			lineupIQs.push(iq);

			fptsHistories.push({
				managerID: key,
				fptsFor: round(record.fptsFor),
				fptsAgainst: round(record.fptsAgainst),
				fptsPerGame: round(record.fptsFor / totalGames)
			});

			if (record.ties > 0) showTies = true;
		}

		if (transactionTotals?.allTime) {
			for (const managerID in transactionTotals.allTime) {
				const stats = transactionTotals.allTime[managerID];
				tradesData.push({ managerID, trades: stats.trade });
				waiversData.push({ managerID, waivers: stats.waiver });
			}
		}

		winPercentages.sort((a, b) => b.percentage - a.percentage);
		lineupIQs.sort((a, b) => (b.iq ?? 0) - (a.iq ?? 0));
		fptsHistories.sort((a, b) => b.fptsFor - a.fptsFor);
		tradesData.sort((a, b) => b.trades - a.trades);
		waiversData.sort((a, b) => b.waivers - a.waivers);
	};

	$: setRankingsData(leagueManagerRecords);
</script>

<RecordsAndRankings
	blowouts={allTimeBiggestBlowouts}
	closestMatchups={allTimeClosestMatchups}
	weekRecords={leagueWeekHighs}
	weekLows={leagueWeekLows}
	seasonLongRecords={mostSeasonLongPoints}
	seasonLongLows={leastSeasonLongPoints}
	{showTies}
	{winPercentages}
	{fptsHistories}
	{lineupIQs}
	{tradesData}
	{waiversData}
	prefix="All-Time"
	allTime={true}
	{leagueTeamManagers}
	{key}
/>
