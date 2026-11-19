# Play check (what is on Google Play)

One tab that lists every app of a Google Play developer account and says where each one stands: published, in review, rejected, approved but not published yet, a draft, or only in testing. It answers "did that release go out?" without opening Play Console app by app.

Open it from the **+** menu (**Play check**) or with Ctrl+Shift+L (Cmd+Shift+L on macOS).

## What it shows

For each app, sorted so that what needs a look comes first:

| On the row | Meaning |
|---|---|
| The state on the left | **Rejected**, **In review**, **Approved, not published**, **Draft**, **Testing only**, **Published**, **No release** |
| Release chips | Every release Play reports on each track (production, open test, closed test, internal test) with its name and its state |
| Store page | Whether the public store page of the package answers. A published app without a store page is listed under **Needs a look** |
| **Store page** | Opens the public page in your browser |
| **Open space** | Goes to the space of the project folder that builds the app (or makes one), on the machine the project is on |

The filters at the top count the apps in each group: all, in review, needs a look (rejected, approved but not published, draft, a track that could not be read, published without a store page), published, testing only.

## Adding an account

Press **+ Account**, choose the machine that has the key file, and give a name and the path of a Play **service-account key** (the JSON file fastlane's `supply` uploads with). From a terminal:

```sh
nv-play account add Toris ~/projects/play-key.json [--projects ~/projects]
nv-play list --refresh
```

`nv-play` is `node ~/.config/herdr-app/bin/nv-play.mjs`. The key file stays where it is; only its path is kept, in `~/.config/herdr-app/play/play.json`. The last answer is kept in `play/cache.json`, so the tab opens at once and asks Google again when that answer is older than an hour, or when you press **Check now**. Google limits how often releases can be listed (a check is four requests per app), so pressing **Check now** many times in a row ends in "quota exceeded" for a while; the tracks that could not be read keep what the last check saw, and the row says so.

The service account needs, in Play Console (Users and permissions), access to the apps with at least *View app information*, and in its Google Cloud project the **Google Play Android Developer API** and the **Google Play Developer Reporting API** enabled. The second one is what lists the account's apps.

## It only reads

Every request to Google is a GET (plus the one token request): the list of apps, the releases of each track, and the public store page. It never creates an edit, uploads, promotes or changes a release. It spends no agent tokens.

## Several machines

The tab runs the same script on this computer and on every connected machine, so an account is checked on the machine that has its key: the key does not have to be copied. Project folders are matched on that machine too, from `android/app/build.gradle(.kts)` (`applicationId`) or a fastlane `Appfile` (`package_name`) of each folder in `--projects` (default `~/projects`).

## What it does not do

- It does not show installs, ratings, reviews or revenue.
- It does not check the App Store.
- An app is matched to a project folder only when the folder has one of the files above; a Godot or Unity project without them has no **Open space** button.
