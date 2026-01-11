"""
Module for handling Aylo API trailer extraction
"""

import atexit
import datetime as datetime_mod
import json
import re
from pathlib import Path as _Path
from urllib.parse import urlparse

import requests
from flask import current_app

# ─── Aylo API token cache ────────────────────────────────────────────────────
__AYLO_TOKENS_FILE = _Path(__file__).parent / "aylo_tokens.json"
try:
    __AYLO_TOKENS = json.loads(__AYLO_TOKENS_FILE.read_text(encoding="utf-8"))
except Exception:
    __AYLO_TOKENS = {}


@atexit.register
def __save_aylo_tokens():
    __AYLO_TOKENS_FILE.write_text(json.dumps(__AYLO_TOKENS, indent=2), encoding="utf-8")


def _aylo_site_name(url: str) -> str:
    return urlparse(url).netloc.split(".")[-2]


def _get_aylo_token(domain: str) -> str | None:
    today = datetime_mod.datetime.utcnow().strftime("%Y-%m-%d")
    entry = __AYLO_TOKENS.get(domain)
    if entry and entry.get("date") == today and entry.get("token"):
        return entry["token"]
    # fetch fresh token (even on 404 the response sets the cookie)
    resp = requests.get(
        f"https://www.{domain}.com", headers={"User-Agent": "Mozilla/5.0"}, timeout=10
    )
    token = resp.cookies.get("instance_token")
    if not token:
        current_app.logger.error(f"Failed to obtain Aylo instance_token for {domain}")
        return None
    __AYLO_TOKENS[domain] = {"token": token, "date": today}
    return token


def get_trailer_aylo(url: str) -> str | None:
    """
    Try Aylo API for trailers on Brazzers/RealityKings/etc.
    """
    domain = _aylo_site_name(url)
    token = _get_aylo_token(domain)
    if not token:
        return None

    m = re.search(r"/(\d+)(?:/|$)", url)
    if not m:
        return None
    scene_id = m.group(1)

    api_url = f"https://site-api.project1service.com/v2/releases/{scene_id}"
    headers = {
        "Instance": token,
        "User-Agent": "Mozilla/5.0",
        "Origin": f"https://{domain}.com",
        "Referer": f"https://{domain}.com",
    }
    try:
        resp = requests.get(api_url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json().get("result") or resp.json()

        # old keys
        if trailer := data.get("trailerUrl") or data.get("downloadUrls", {}).get(
            "trailer"
        ):
            return trailer

        # new RealityKings-style "videos" → * → "files" → "<res>" → "urls.view"
        videos = data.get("videos", {})
        best = {"res": 0, "url": None}
        for section in videos.values():
            for fmt_label, info in section.get("files", {}).items():
                m = re.match(r"(\d+)", info.get("format", "0"))
                res = int(m.group(1)) if m else 0
                view = info.get("urls", {}).get("view")
                if view and res > best["res"]:
                    best = {"res": res, "url": view}
        if best["url"]:
            return best["url"]

        # nothing found
        current_app.logger.error(f"No trailer URL found in API result for {url}")
        return None

    except Exception as e:
        current_app.logger.error(f"Aylo API error for {url}: {e}")
        return None


# List of Aylo-powered domains
AYLO_DOMAINS = {
    "8thstreetlatinas.com",
    "amateureuro.com",
    "bangbros.com",
    "biempire.com",
    "bigdicksatschool.com",
    "bignaturals.com",
    "blackmaleme.com",
    "brazzers.com",
    "brazzersextra.com",
    "brazzersvr.com",
    "cumfiesta.com",
    "danejones.com",
    "daredorm.com",
    "devianthardcore.com",
    "dilfed.com",
    "digitalplayground.com",
    "digitalplaygroundnetwork.com",
    "doe-tv.com",
    "doegirls.com",
    "doghousedigital.com",
    "erito.com",
    "eurosexparties.com",
    "familyhookups.com",
    "familysinners.com",
    "forbondage.com",
    "gfleaks.com",
    "girlgrind.com",
    "godsofmen.com",
    "happytugs.com",
    "hdlove.com",
    "hentaipros.com",
    "hornybirds.com",
    "hotgirlsgame.com",
    "househumpers.com",
    "iconmale.com",
    "iknowthatgirl.com",
    "jizzorgy.com",
    "kinkyspa.com",
    "lesbea.com",
    "letsdoeit.com",
    "letsttryanal.com",
    "lilhumpers.com",
    "lookathernow.com",
    "mamacitaz.com",
    "men.com",
    "mennetwork.com",
    "menofuk.com",
    "metrohd.com",
    "mikeinbrazil.com",
    "mikesapartment.com",
    "milfed.com",
    "milfhunter.com",
    "milehighmedia.com",
    "mofos.com",
    "mofosnetwork.com",
    "momsbangteens.com",
    "momslickteens.com",
    "moneytalks.com",
    "monstercurves.com",
    "nextdoorhobby.com",
    "noirmale.com",
    "propertysex.com",
    "publicpickups.com",
    "pure18.com",
    "realitydudes.com",
    "realitydudesnetwork.com",
    "realityjunkies.com",
    "realitykings.com",
    "realitykingsnetwork.com",
    "recklessinmiami.com",
    "rk.com",
    "rkprime.com",
    "seancody.com",
    "sexselector.com",
    "sexyhub.com",
    "shewillcheat.com",
    "sneakysex.com",
    "squirted.com",
    "str8togay.com",
    "sweetheartvideo.com",
    "sweetsinner.com",
    "teenslovehugecocks.com",
    "thegayoffice.com",
    "toptobottom.com",
    "transbella.com",
    "transsensual.com",
    "trueamateurs.com",
    "tube8vip.com",
    "twinkpop.com",
    "twistys.com",
    "twistysnetwork.com",
    "vipsexvault.com",
    "virtualporn.com",
    "voyr.com",
    "welivetogether.com",
    "whynotbi.com",
    "workmeharder.com",
    "xempire.com",
}
