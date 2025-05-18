import csv
import json
import uuid

def csv_to_json(csv_file_path, json_file_path):
    data = []

    with open(csv_file_path, mode='r', newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for idx, row in enumerate(reader, start=1):
            # Split player name assuming format "First Last"
            first_name, last_name = row['player'].split(' ', 1)
            
            # Construct the draft pick entry
            pick_data = {
                "draft_id": str(uuid.uuid4()),  # Or a consistent ID if you have one
                "draft_slot": int(row['pick']),
                "is_keeper": None,
                "metadata": {
                    "first_name": first_name,
                    "injury_status": None,
                    "last_name": last_name,
                    "news_updated": None,
                    "number": None,
                    "player_id": str(idx),  # Use a real ID if available
                    "position": row['player position'],
                    "sport": "nfl",
                    "status": None,
                    "team": row['team'],
                    "team_abbr": "",
                    "team_changed_at": "",
                    "years_exp": None
                },
                "pick_no": int(row['pick']),
                "picked_by": None,
                "player_id": str(idx),  # Should match metadata.player_id
                "reactions": None,
                "roster_id": None,
                "round": int(row['round'])
            }

            data.append(pick_data)

    with open(json_file_path, 'w', encoding='utf-8') as jsonfile:
        json.dump(data, jsonfile, indent=4)

# Example usage
csv_to_json('draft_data.csv', 'output_draft_data.json')
