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

	let winPercentages = [];
	let lineupIQs = [];
	let fptsHistories = [];
	let tradesData = [];
	let waiversData = [];
	let showTies = false;

	// ✅ Immediately initialize trade/waiver data to populate logs/UI quickly
	if (transactionTotals?.allTime) {
		for (const managerID in transactionTotals.allTime) {
			tradesData.push({
				managerID,
				trades: transactionTotals.allTime[managerID].trade,
			});
			waiversData.push({
				managerID,
				waivers: transactionTotals.allTime[managerID].waiver,
			});
		}
	}

	const setRankingsData = (lRR) => {
		winPercentages = [];
		lineupIQs = [];
		fptsHistories = [];
		showTies = false;

		for (const key in lRR) {
			const rec = lRR[key];
			const games = rec.wins + rec.ties + rec.losses || 1;

			winPercentages.push({
				managerID: key,
				percentage: round(((rec.wins + rec.ties / 2) / games) * 100),
				wins: rec.wins,
				ties: rec.ties,
				losses: rec.losses,
			});

			const iq = {
				managerID: key,
				fpts: round(rec.fptsFor),
			};

			if (rec.potentialPoints) {
				iq.iq = round((rec.fptsFor / rec.potentialPoints) * 100);
				iq.potentialPoints = round(rec.potentialPoints);
			}

			lineupIQs.push(iq);

			fptsHistories.push({
				managerID: key,
				fptsFor: round(rec.fptsFor),
				fptsAgainst: round(rec.fptsAgainst),
				fptsPerGame: round(rec.fptsFor / games),
			});

			if (rec.ties > 0) showTies = true;
		}

		winPercentages.sort((a, b) => b.percentage - a.percentage);
		lineupIQs.sort((a, b) => (b.iq ?? 0) - (a.iq ?? 0));
		fptsHistories.sort((a, b) => b.fptsFor - a.fptsFor);
	};

	// ✅ Run when leagueManagerRecords changes
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
