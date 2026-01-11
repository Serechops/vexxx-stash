"""
Module for handling Algolia-powered site trailer extraction
"""

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import current_app

# ───────── Algolia Config ─────────
ALGOLIA_APP_ID = "TSMKFA364Q"
ALGOLIA_AGENT = (
    "Algolia for JavaScript (4.22.1); Browser; instantsearch.js (4.64.3); "
    "react (18.2.0); react-instantsearch (7.5.5); react-instantsearch-core (7.5.5); JS Helper (3.16.2)"
)

# ───────── Algolia-powered sites ─────────
# Simple list of supported domains
ALGOLIA_SITES = [
    "1000facials.com",
    "21naturals.com",
    "21sextreme.com",
    "21sextury.com",
    "3rddegreefilms.com",
    "accidentalgangbang.com",
    "activeduty.com",
    "adamandevepictures.com",
    "addicted2girls.com",
    "adulttime.com",
    "adulttimepilots.com",
    "agentredgirl.com",
    "allblackx.com",
    "allgirlmassage.com",
    "analteenangels.com",
    "asgmax.com",
    "asmrfantasy.com",
    "assholefever.com",
    "austinwilde.com",
    "beingtrans247.com",
    "biphoria.com",
    "blackmeatwhitefeet.com",
    "blacksonblondes.com",
    "blacksoncougars.com",
    "blowmepov.com",
    "bskow.com",
    "burningangel.com",
    "caughtfapping.com",
    "codycummings.com",
    "cuckoldsessions.com",
    "cumbang.com",
    "darkx.com",
    "devilsfilm.com",
    "devilstgirls.com",
    "dfxtra.com",
    "diabolic.com",
    "disruptivefilms.com",
    "dogfartnetwork.com",
    "downlowboys.com",
    "dpfanatics.com",
    "eroticax.com",
    "evilangel.com",
    "extrabigdicks.com",
    "extremepickups.com",
    "falconstudios.com",
    "famedigital.com",
    "familycreep.com",
    "fantasymassage.com",
    "filthykings.com",
    "footsiebabes.com",
    "forbiddenseductions.com",
    "gangbangcreampie.com",
    "genderxfilms.com",
    "getupclose.com",
    "girlcore.com",
    "girlfriendsfilms.com",
    "girlstryanal.com",
    "girlsway.com",
    "givemeteens.com",
    "gloryhole.com",
    "gloryholeinitiations.com",
    "gloryholesecrets.com",
    "hairyundies.com",
    "hardx.com",
    "interracialblowbang.com",
    "interracialpickups.com",
    "interracialvision.com",
    "isthisreal.com",
    "joymii.com",
    "kissmefuckme.com",
    "lethalhardcore.com",
    "lethalhardcorevr.com",
    "lesbianx.com",
    "lezbebad.com",
    "lezcuties.com",
    "marcusmojo.com",
    "massage-parlor.com",
    "menover30.com",
    "milkingtable.com",
    "mixedx.com",
    "modeltime.com",
    "moderndaysins.com",
    "mommyblowsbest.com",
    "mommysboy.com",
    "mommysgirl.com",
    "muses.com",
    "mypervyfamily.com",
    "nextdoorbuddies.com",
    "nextdoorcasting.com",
    "nextdoorfilms.com",
    "nextdoorhomemade.com",
    "nextdoormale.com",
    "nextdoororiginals.com",
    "nextdoorraw.com",
    "nextdoorstudios.com",
    "nextdoortaboo.com",
    "nextdoortwink.com",
    "nudefightclub.com",
    "nurumassage.com",
    "officemsconduct.com",
    "onlyteenblowjobs.com",
    "oopsie.com",
    "outofthefamily.com",
    "pansexualx.com",
    "peternorth.com",
    "prettydirty.com",
    "pridestudios.com",
    "puretaboo.com",
    "ragingstallion.com",
    "roccosiffredi.com",
    "roddaily.com",
    "rodsroom.com",
    "sabiendemonia.com",
    "samuelotoole.com",
    "soapymassage.com",
    "stagcollective.com",
    "tabooheat.com",
    "teensneaks.com",
    "theyeslist.com",
    "throated.com",
    "tommydxxx.com",
    "touchmywife.com",
    "transangels.com",
    "transangelsnetwork.com",
    "transfixed.com",
    "transgressivefilms.com",
    "transgressivexxx.com",
    "transharder.com",
    "trickyspa.com",
    "truelesbian.com",
    "trystanbull.com",
    "tsfactor.com",
    "upclosevr.com",
    "vivid.com",
    "watchingmydaughtergoblack.com",
    "watchingmymomgoblack.com",
    "webyoung.com",
    "wefuckblackgirls.com",
    "welikegirls.com",
    "wicked.com",
    "wolfwagner.com",
    "xempire.com",
    "zebragirls.com",
    "zerotolerancefilms.com",
]

# Special cases with non-standard patterns
ALGOLIA_SPECIAL_SITES = {
    "blowpass.com": {
        "static_key_url": "https://members.blowpass.com/en",
        "site_domain": "members.blowpass.com",
    }
}


# Generate configs for standard sites
def generate_site_configs():
    configs = {}

    # Add standard sites with the template
    for domain in ALGOLIA_SITES:
        configs[domain] = {
            "static_key_url": f"https://www.{domain}/en",
            "site_domain": f"www.{domain}",
        }

    # Add special cases
    configs.update(ALGOLIA_SPECIAL_SITES)

    return configs


# Create the actual config dictionary
SITE_CONFIGS = generate_site_configs()


# Get cache directory from app config or default to temp directory
def get_cache_dir():
    try:
        cache_dir = current_app.config.get(
            "CACHE_DIR", os.path.join(os.path.dirname(__file__), "cache")
        )
        if not os.path.exists(cache_dir):
            os.makedirs(cache_dir)
        return cache_dir
    except Exception as e:
        current_app.logger.error(f"Error creating cache directory: {e}")
        return os.path.join(os.path.dirname(__file__), "cache")


# Fetch and cache Algolia API key
def fetch_algolia_key(domain_key):
    """Fetch and cache Algolia API key for a specific domain"""
    try:
        conf = SITE_CONFIGS[domain_key]
        cache_dir = get_cache_dir()
        cache_file = os.path.join(cache_dir, f"{domain_key}_api.json")
        cache = Path(cache_file)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        # Return cached key if from today
        if cache.exists():
            try:
                data = json.loads(cache.read_text())
                if data.get("date") == today and data.get("api_key"):
                    current_app.logger.debug(
                        f"Using cached Algolia key for {domain_key}"
                    )
                    return data["api_key"]
            except Exception as e:
                current_app.logger.error(f"Error reading cache for {domain_key}: {e}")

        # Otherwise scrape the site's /en page for window.env
        current_app.logger.info(f"Fetching new Algolia key for {domain_key}")
        resp = requests.get(
            conf["static_key_url"], headers={"User-Agent": "Mozilla/5.0"}, timeout=10
        )
        resp.raise_for_status()

        m = re.search(r"window\.env\s*=\s*({.+?});", resp.text, re.DOTALL)
        if not m:
            current_app.logger.error(f"Could not find window.env in {domain_key} page")
            return None

        env = json.loads(m.group(1))
        key = env.get("api", {}).get("algolia", {}).get("apiKey")

        if key:
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"date": today, "api_key": key}))
            current_app.logger.info(f"Cached new Algolia key for {domain_key}")
            return key
        else:
            current_app.logger.error(f"No Algolia API key found for {domain_key}")
            return None
    except Exception as e:
        current_app.logger.error(f"Error fetching Algolia key for {domain_key}: {e}")
        return None


# Get trailer using Algolia search
def get_trailer_algolia(url, api_key, domain_key):
    """Get trailer URL using Algolia search API"""
    try:
        # Extract the clip ID from the URL
        m = re.search(r"/(\d+)(?:/|$)", url)
        if not m:
            current_app.logger.error(f"Could not extract clip ID from URL: {url}")
            return None

        clip_id = m.group(1)
        conf = SITE_CONFIGS[domain_key]
        current_app.logger.info(
            f"Getting Algolia trailer for clip ID: {clip_id} on {domain_key}"
        )

        endpoint = (
            f"https://{ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/all_scenes/query"
        )
        params = (
            "clickAnalytics=true"
            f"&facetFilters=%5B%5B%22clip_id%3A{clip_id}%22%5D%5D"
            "&facets=%5B%5D"
            "&hitsPerPage=1"
            "&tagFilters="
        )
        body = {"params": params}

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:79.0)",
            "Origin": f"https://{conf['site_domain']}",
            "Referer": f"https://{conf['site_domain']}",
            "x-algolia-api-key": api_key,
            "x-algolia-application-id": ALGOLIA_APP_ID,
            "x-algolia-agent": ALGOLIA_AGENT,
            "Accept": "*/*",
            "Content-Type": "application/json",
        }

        resp = requests.post(endpoint, headers=headers, json=body, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        # Single-index returns "hits" at top, multi-index returns "results"
        hits = data.get("hits") or data.get("results", [{}])[0].get("hits", [])
        if not hits:
            current_app.logger.error(f"No hits found in Algolia response for {url}")
            return None

        # Pick the highest-resolution trailer_url
        vf = hits[0].get("video_formats", [])
        if not vf:
            current_app.logger.error(
                f"No video formats found in Algolia response for {url}"
            )
            return None

        best = max(
            vf, key=lambda f: int(re.match(r"(\d+)", f.get("format", "0")).group(1))
        )
        trailer_url = best.get("trailer_url")

        if trailer_url:
            current_app.logger.info(f"Found Algolia trailer URL: {trailer_url}")
            return trailer_url
        else:
            current_app.logger.error(f"No trailer URL found in best format for {url}")
            return None

    except Exception as e:
        current_app.logger.error(f"Error getting Algolia trailer for {url}: {e}")
        return None
