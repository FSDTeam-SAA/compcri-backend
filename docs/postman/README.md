# Compcri Postman documentation

Import both files into Postman:

- `Compcri-v1.postman_collection.json`
- `Compcri-local.postman_environment.json`

Select **Compcri Local**, start the API, and use this order:

1. Run **Auth → Register** or **Auth → Login**. Tokens are saved automatically.
2. Run **Users → Get current profile** to save `calendarId`.
3. Use the Calendar, Events, Contacts, Groups, Delegations, AI, and Notifications folders.
   For **AI → Send audio**, select a local FLAC, MP3, MP4, M4A, OGG, WAV, or WEBM file in the `audio` form-data field.
4. Put the generated administrator password from `.env` into the private `adminPassword` environment value before running Admin login.
5. Put the exact `REVENUECAT_WEBHOOK_AUTH` value into the private `revenueCatWebhookAuth` environment value before testing the webhook.

The exported environment intentionally contains no API keys, passwords, or live tokens. Do not export a populated Postman environment into source control.

Run `npm run docs:postman` whenever `docs/openapi.js` changes. The generator rebuilds every documented route, supplies representative request bodies, adds the standard success-contract assertion, and captures commonly reused IDs and tokens.
