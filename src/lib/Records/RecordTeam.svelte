<script>
	import { onMount } from 'svelte';
	import { getAvatarFromTeamManagers, getTeamNameFromTeamManagers, renderManagerNames } from "$lib/utils/helperFunctions/universalFunctions";

	export let leagueTeamManagers, managerID = null, rosterID = null, year, compressed = false, points = null;

	let user = null;
	let logMessages = [];

	function log(message, data = null) {
		const output = data ? `${message}: ${JSON.stringify(data)}` : message;
		logMessages = [...logMessages, output]; // reassign for Svelte reactivity
		console.log(output);
	}

	onMount(() => {
		if (managerID && leagueTeamManagers?.users?.[managerID]) {
			user = leagueTeamManagers.users[managerID];
			log("Found user from managerID", user);
		} else if (rosterID) {
			const avatar = getAvatarFromTeamManagers(leagueTeamManagers, rosterID, year);
			const teamName = getTeamNameFromTeamManagers(leagueTeamManagers, rosterID, year);
			const managerNames = renderManagerNames(leagueTeamManagers, rosterID, year);

			log("Resolved avatar from rosterID", avatar);
			log("Resolved teamName from rosterID", teamName);
			log("Resolved managerNames from rosterID", managerNames);
		} else {
			log("No managerID or rosterID provided");
		}
	});
</script>

<style>
	.teamAvatar {
		vertical-align: middle;
		border-radius: 50%;
		height: 40px;
		margin-right: 15px;
		border: 0.25px solid #777;
	}

	.recordTeam {
		display: flex;
	}

	.name {
		margin: auto 0;
	}

	.managerNames {
		font-size: 0.75em;
		font-style: italic;
		color: var(--g999);
		max-width: 180px;
		white-space: normal;
		text-align: left;
	}

	.compressed {
		height: 30px;
		margin-right: 6px;
	}

	@media (max-width: 405px) {
		.teamAvatar {
			height: 25px;
			margin-right: 8px;
		}
		.compressed {
			height: 20px;
			margin-right: 4px;
		}
	}

	@media (max-width: 295px) {
		.teamAvatar {
			display: none;
		}
	}

	.log-output {
		background-color: #222;
		color: #ccc;
		font-size: 0.75em;
		padding: 0.75em;
		margin-top: 1em;
		border-radius: 5px;
		border: 1px solid #444;
		white-space: pre-wrap;
	}
</style>

<div class="recordTeam">
	{#if user}
		<img alt="team avatar" class="teamAvatar{compressed ? ' compressed' : ''}" src={`https://sleepercdn.com/avatars/thumbs/${user.avatar}`} />
	{:else if rosterID}
		<img alt="team avatar" class="teamAvatar{compressed ? ' compressed' : ''}" src={getAvatarFromTeamManagers(leagueTeamManagers, rosterID, year)} />
	{/if}

	<span class="name">
		<div class="teamName">
			{#if user}
				{user.display_name}
			{:else if rosterID}
				{getTeamNameFromTeamManagers(leagueTeamManagers, rosterID, year)}
				{points ? ` (${points})` : ""}
			{/if}
		</div>

		{#if !user && rosterID}
			<div class="managerNames">
				{renderManagerNames(leagueTeamManagers, rosterID, year)}
			</div>
		{/if}
	</span>
</div>

{#if logMessages.length}
	<div class="log-output">
		<h4>Debug Logs</h4>
		<pre>{logMessages.join('\n')}</pre>
	</div>
{/if}
