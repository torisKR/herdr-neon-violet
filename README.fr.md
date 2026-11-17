# herdr-neon-violet

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · **Français**

Un thème violet néon et un ensemble de plugins pour [herdr](https://herdr.dev), l'espace de travail en terminal pour les agents de programmation IA. Il ajoute un tableau **ALL agents**, une fenêtre **Devices** (adb, émulateurs, simulateurs iOS), un **navigateur dans le terminal**, les réglages de copie via SSH et des jeux de couleurs assortis pour le terminal.

![ALL agents board](docs/agents.png)

## Contenu

| Fonction | Touche | Ce qu'elle fait |
| --- | --- | --- |
| Thème violet néon | | Les couleurs de toute l'interface herdr et une liste d'agents plus détaillée dans la barre latérale |
| ALL agents | `prefix` `a` | Tous les agents en cours d'exécution, en mosaïque dans un seul onglet |
| Devices | `prefix` `d` | Appareils adb, émulateurs Android et simulateurs iOS dans une seule liste |
| Navigateur | `prefix` `u` | Lire des pages web dans le terminal, y compris via SSH |
| Fichiers et pull requests | `prefix` `f` | Une arborescence de fichiers avec aperçu, et les pull requests du dépôt : lire, commenter, fusionner |
| Changer d'agent | `prefix` `,` / `prefix` `.` | Passer à l'agent précédent / suivant |
| Copie via SSH | glisser | Faites glisser sur du texte dans un panneau distant : il arrive dans votre propre presse-papiers |

`prefix` vaut `ctrl+b` par défaut.

## Captures d'écran

**Vue principale.** Le bas de la barre latérale liste les agents par ordre d'urgence : bloqué, en cours, terminé, inactif.

![main](docs/main.png)

**Devices.** Les appareils connectés, ainsi que les émulateurs et simulateurs qui ne sont pas encore lancés. Appuyez sur `enter` pour en démarrer un et sur `y` pour copier l'identifiant d'un appareil.

![devices](docs/devices.png)

**Navigateur.** Il s'ouvre dans un panneau à droite et affiche la page sous forme de texte. Tapez le numéro d'un lien puis `enter` pour le suivre.

![browser](docs/browser.png)

> Les conversations d'agents et la liste d'appareils de ces captures proviennent des données d'exemple du dossier `demo/`.

## Installation

Nécessite herdr 0.9.5 ou plus récent. Les outils tiennent dans un petit binaire Rust, `nv` : le script d'installation le compile si Rust est installé et télécharge sinon une version précompilée. Les pull requests demandent le GitHub CLI (`gh`).

**macOS / Linux**

```bash
git clone https://github.com/torisKR/herdr-neon-violet.git
cd herdr-neon-violet
./install.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/torisKR/herdr-neon-violet.git
cd herdr-neon-violet
.\install.ps1
```

Le script d'installation fait trois choses :

1. Il sauvegarde votre configuration herdr actuelle dans `config.toml.bak-<date>` et installe `config/config.toml`.
2. Il lie le dossier `plugin/` comme plugin herdr (`herdr plugin link`).
3. Il installe un jeu de couleurs pour le terminal (thème Ghostty ou jeu de couleurs Windows Terminal).

Pour n'utiliser que le plugin, installez-le directement depuis GitHub et copiez les blocs `[[keys.command]]` de `config/config.toml` dans votre propre configuration :

```bash
herdr plugin install torisKR/herdr-neon-violet/plugin
```

### Accorder les couleurs du terminal

Les panneaux herdr reprennent la couleur de fond du terminal qui les héberge. Le terminal doit donc utiliser les mêmes couleurs pour ressembler aux captures.

| Terminal | Fichier | Comment l'appliquer |
| --- | --- | --- |
| Ghostty | `terminal/ghostty-neon-violet` | Copiez-le dans `~/.config/ghostty/themes/neon-violet` et ajoutez `theme = neon-violet` à votre configuration |
| iTerm2 | `terminal/neon-violet.itermcolors` | Settings → Profiles → Colors → Color Presets → Import |
| Windows Terminal | `terminal/windows-terminal.json` | `install.ps1` l'ajoute. Redémarrez le terminal et choisissez « Neon Violet » comme jeu de couleurs du profil |

## Application de bureau Herdr

Le même ensemble pour l'application de bureau Herdr se trouve dans `app/`. Si le dossier `~/.config/herdr-app` existe, les scripts d'installation l'y copient et ajoutent les raccourcis à `keys.json` sans remplacer les touches que vous utilisez déjà.

| Élément | Touche | Ce qu'il fait |
| --- | --- | --- |
| Thème `neon-violet` | | Les mêmes couleurs pour l'application. Choisissez-le dans les réglages ou lancez `herdr-app do app.theme --name neon-violet` |
| Disposition `all-agents` | `ctrl+shift+a` | Le terminal en direct de chaque agent dans une seule grille, les plus urgents d'abord. `ctrl+shift+l` revient aux autres dispositions |
| Devices | `ctrl+shift+d` | Appareils, émulateurs et simulateurs de cet ordinateur et de toutes les machines connectées. Cliquez sur un élément arrêté pour le démarrer |
| Navigateur | `ctrl+shift+u` | Ouvre le navigateur en mode texte dans un panneau à droite |
| Disposition `neon-violet` | `ctrl+shift+l` | La disposition principale avec une fenêtre floutée et translucide et la liste de tâches |
| Pull requests | `ctrl+shift+g` | Les pull requests ouvertes du dépôt où vous êtes : description, fichiers modifiés, commentaires. Commentez et fusionnez depuis le panneau |
| To-do | | Une liste flottante en haut à droite de ce que vous avez demandé à vos agents |

Dans la disposition `all-agents` :

- Filtrez par état avec les pastilles du haut ou avec `ctrl+d` terminés, `ctrl+w` en cours, `ctrl+i` inactifs, `ctrl+b` bloqués, `ctrl+a` tous.
- Tant que cette disposition est affichée, ces cinq touches servent au filtre et n'atteignent pas le programme du terminal.
- Cliquez sur l'en-tête d'une carte pour ouvrir cet agent dans la disposition principale.

Le thème est sombre. Si l'application est réglée pour toujours utiliser l'apparence claire, passez-la en sombre dans les réglages pour que le thème s'affiche. Dans l'application, faire glisser sur du texte le copie déjà, y compris sur les machines distantes.

## Copier via SSH en faisant glisser

La configuration définit `copy_on_select = true` : faire glisser sur du texte dans herdr le copie. Sur une machine distante, l'endroit où arrive le texte dépend de la façon dont vous vous êtes connecté.

- **Connexion avec `herdr --remote <hôte>` ou une machine enregistrée.** Le herdr qui dessine l'écran tourne sur votre propre ordinateur, donc le texte va directement dans votre presse-papiers. Rien à configurer.
- **Connexion avec `ssh`, puis `herdr` lancé à l'intérieur.** herdr envoie le texte avec une séquence d'échappement du terminal appelée OSC 52, et votre terminal le place dans le presse-papiers. Le terminal doit l'autoriser.
  - iTerm2 : Settings → General → Selection → activez « Applications in terminal may access clipboard »
  - Ghostty : `clipboard-write = allow`
  - Le Terminal.app fourni avec macOS ne prend pas en charge OSC 52. Utilisez la méthode `herdr --remote` ci-dessus.

## ALL agents

`prefix` `a` ouvre l'onglet « ALL agents », ou y bascule s'il est déjà ouvert.

- Une carte par agent, avec sa sortie récente actualisée toutes les 1,5 seconde.
- Tri par urgence : BLOCKED, WORKING, DONE, IDLE.
- Filtrer par état : `ctrl+d` terminés, `ctrl+w` en cours, `ctrl+i` inactifs, `ctrl+a` tous. Les lettres seules `d`, `w`, `i`, `a` fonctionnent aussi, et `b` montre les agents bloqués.
- Appuyez sur `1`–`9` pour aller au panneau de cet agent, et sur `q` pour fermer.
- Le tableau montre les agents du serveur herdr sur lequel il tourne. Les agents des autres machines apparaissent dans la barre latérale.

## Fichiers et pull requests

`prefix` `f` ouvre un onglet dont la racine est le dossier du panneau où vous étiez. La souris fonctionne : cliquez sur une ligne, faites défiler chaque côté.

| Touche | Fichiers | Pull requests |
| --- | --- | --- |
| `↑` `↓` / `j` `k` | Se déplacer | Se déplacer |
| `enter` ou clic | Ouvrir un fichier, déplier un dossier | Ouvrir la pull request |
| `←` | Replier, ou aller au dossier parent | |
| `space` / `b` | Faire défiler l'aperçu | Faire défiler la pull request |
| `c` | | Écrire un commentaire |
| `m` | | Fusionner. Une confirmation est demandée : `y` fusionne, `s` alterne entre squash, merge et rebase |
| `o` | | Ouvrir sur GitHub |
| `y` | Copier le chemin | |
| `tab` | Passer aux pull requests | Passer aux fichiers |

L'application de bureau Herdr a déjà un explorateur de fichiers (bouton Files en haut à droite) ; ce pack n'y ajoute donc que le panneau des pull requests.

## Liste de tâches

L'application Herdr affiche une liste flottante en haut à droite. Chaque instruction donnée à Claude Code ou à Codex devient une tâche, cochée à la fin du tour avec une notification. Vous pouvez aussi ajouter, cocher et supprimer des tâches vous-même, et la liste couvre toutes les machines connectées.

- Activez-la une fois par machine : `~/.config/herdr-app/bin/nv todo hooks install`. La commande ajoute deux hooks (instruction envoyée, tour terminé) au `settings.json` de Claude Code et au `hooks.json` de Codex, conserve vos hooks existants et écrit une sauvegarde. `nv todo hooks remove` les retire.
- `↔` et `↕` changent la largeur et la hauteur, `–` replie la liste, et vous pouvez la faire glisser où vous voulez.
- Depuis un shell : `nv todo add "texte"`, `nv todo done <id>`, `nv todo list`.

## Devices

`prefix` `d` l'ouvre. Il lit les informations suivantes sur la machine où tourne le panneau :

- `adb devices -l` : appareils Android connectés et émulateurs en cours d'exécution, avec la version d'Android
- `emulator -list-avds` : émulateurs qui ne sont pas encore lancés
- Sur macOS, `xcrun simctl` et `xcrun xctrace` : simulateurs iOS, iPhone et iPad connectés

`adb` et `emulator` sont recherchés dans `PATH`, dans `ANDROID_HOME` et `ANDROID_SDK_ROOT`, et aux emplacements par défaut d'Android Studio comme `~/Library/Android/sdk`.

## Navigateur

`prefix` `u` l'ouvre. Saisissez une adresse ou une recherche. Les recherches passent par DuckDuckGo.

| Touche | Action |
| --- | --- |
| `j` / `k`, flèches | Défiler |
| `space` / `b` | Page suivante / précédente |
| numéro + `enter` | Suivre le lien portant ce numéro |
| `u` ou `/` | Saisir une nouvelle adresse ou recherche |
| `h` | Retour |
| `y` | Copier l'adresse actuelle dans votre presse-papiers |
| `o` | Ouvrir dans le navigateur par défaut de la machine où tourne le panneau |
| `q` | Fermer |

C'est un navigateur en mode texte : les pages dessinées par JavaScript peuvent paraître vides. Il convient pour lire de la documentation et vérifier ce que renvoie un serveur de développement.

Un `ctrl`+clic sur un lien `http://localhost:<port>` dans un panneau l'ouvre dans ce navigateur. Un serveur de développement sur une machine distante se trouve sur cette machine, et non sur le localhost de votre portable. Les autres liens s'ouvrent dans votre propre navigateur, comme herdr le fait par défaut.

## Environnement testé

- Windows 11, herdr 0.9.5, nv 0.2 (Rust) : le thème et les trois panneaux (ALL agents, Devices, Navigateur) ont été lancés et vérifiés.
- Application de bureau Herdr sous Windows 11 : le thème, la disposition `all-agents` avec ses filtres et Devices ont été lancés dans l'application. Devices a listé de vrais appareils Android, émulateurs et simulateurs iOS d'un Mac connecté.
- Le panneau Devices du plugin terminal a été vérifié avec les sorties d'exemple de `demo/fixtures` ; les mêmes commandes renvoient ce format sur un vrai Mac. L'ensemble n'a pas encore été installé sur macOS lui-même. Ouvrez une issue si quelque chose ne va pas.

## Remerciements

Les couleurs s'inspirent d'une capture d'écran du thème Cyber Purple 77 pour VS Code et ont été choisies à nouveau pour les jetons de couleur de herdr.

## Licence

MIT
