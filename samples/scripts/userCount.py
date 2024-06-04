import json
from datetime import datetime, timedelta, timezone
import click
import girder_client

# Sample file to get the number of users over the last year

apiURL = "viame.kitware.com"
port = 443

def login():
    gc = girder_client.GirderClient(apiURL, port=port, apiRoot="girder/api/v1")
    gc.authenticate(interactive=True)
    return gc

def fetch_all_datasets(gc):
    results = []
    offset = 0
    limit = 5000

    while True:
        response = gc.get('dive_dataset', parameters={'limit': limit, 'offset': offset, 'sort': 'created', 'sortdir': -1, 'published': 'false', 'shared': 'false'}, jsonResp=False)
        batch_results = response.json()
        results.extend(batch_results)

        # Check the total count from the response header
        total_count = int(response.headers['girder-total-count'])
        if offset + limit >= total_count:
            break
        offset += limit
    
    return results

@click.command(name="GetUsers", help="Get Users and Datasets")
@click.option('--days_count', default=365, help='Number of days to filter the results')
def load_data(days_count):
    gc = login()
    results = fetch_all_datasets(gc)

    # Calculate the date threshold and make it timezone-aware (UTC)
    date_threshold = (datetime.utcnow() - timedelta(days=days_count)).replace(tzinfo=timezone.utc)

    unique_users = {}
    total_datasets = 0

    for dataset in results:
        ownerLogin = dataset.get('ownerLogin') or dataset.get('creatorId')
        if not ownerLogin:
            continue
        
        created_str = dataset.get('created')
        created_date = datetime.fromisoformat(created_str.replace('Z', '+00:00'))

        # Filter datasets based on the days_count
        if created_date < date_threshold:
            continue

        total_datasets += 1

        if ownerLogin not in unique_users:
            unique_users[ownerLogin] = {
                "dateMin": created_date,
                "dateMax": created_date,
                "count": 1
            }
        else:
            if created_date < unique_users[ownerLogin]['dateMin']:
                unique_users[ownerLogin]['dateMin'] = created_date
            if created_date > unique_users[ownerLogin]['dateMax']:
                unique_users[ownerLogin]['dateMax'] = created_date
            unique_users[ownerLogin]['count'] += 1

    # Sort the dictionary by count
    sorted_users = dict(sorted(unique_users.items(), key=lambda item: item[1]['count'], reverse=True))

    # Serialize datetime objects to string
    for user in sorted_users:
        sorted_users[user]['dateMin'] = sorted_users[user]['dateMin'].isoformat()
        sorted_users[user]['dateMax'] = sorted_users[user]['dateMax'].isoformat()

    output_data = {
        "totalUsers": len(sorted_users),
        "totalDatasets": total_datasets,
        "users": sorted_users
    }

    # Write the output to a JSON file
    with open('output.json', 'w') as f:
        json.dump(output_data, f, indent=4)

if __name__ == "__main__":
    load_data()
