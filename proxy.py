import requests
response = requests.get(
url='https://proxy.scrapeops.io/v1/',
params={
    'api_key': 'KEY',
    'url': 'https://trends.google.com/trends/', 
},
)

print('Response Body: ', response.content)