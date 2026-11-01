# Algorithme NOAA (Meeus simplifié) : lever, coucher, crépuscules
import math, datetime as dt
from zoneinfo import ZoneInfo
TZ = ZoneInfo('Europe/Brussels')
def evenement(d, lat, lon, zenith):
    # renvoie (lever, coucher) en UTC pour l'angle zénithal donné (90.833 = coucher, 96 = civil, 102 = nautique)
    jd = d.toordinal() + 1721424.5 + 0.5  # midi UTC
    t = (jd - 2451545.0) / 36525
    L0 = (280.46646 + t*(36000.76983 + 0.0003032*t)) % 360
    M = 357.52911 + t*(35999.05029 - 0.0001537*t)
    e = 0.016708634 - t*(0.000042037 + 0.0000001267*t)
    C = (math.sin(math.radians(M))*(1.914602 - t*(0.004817 + 0.000014*t)) + math.sin(math.radians(2*M))*(0.019993 - 0.000101*t) + math.sin(math.radians(3*M))*0.000289)
    lam = L0 + C - 0.00569 - 0.00478*math.sin(math.radians(125.04 - 1934.136*t))
    eps0 = 23 + (26 + (21.448 - t*(46.815 + t*(0.00059 - t*0.001813)))/60)/60
    eps = eps0 + 0.00256*math.cos(math.radians(125.04 - 1934.136*t))
    decl = math.degrees(math.asin(math.sin(math.radians(eps))*math.sin(math.radians(lam))))
    y = math.tan(math.radians(eps/2))**2
    eot = 4*math.degrees(y*math.sin(2*math.radians(L0)) - 2*e*math.sin(math.radians(M)) + 4*e*y*math.sin(math.radians(M))*math.cos(2*math.radians(L0)) - 0.5*y*y*math.sin(4*math.radians(L0)) - 1.25*e*e*math.sin(2*math.radians(M)))
    cosH = (math.cos(math.radians(zenith)) - math.sin(math.radians(lat))*math.sin(math.radians(decl))) / (math.cos(math.radians(lat))*math.cos(math.radians(decl)))
    H = math.degrees(math.acos(cosH))
    midi = 720 - 4*lon - eot  # minutes UTC
    base = dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc)
    return base + dt.timedelta(minutes=midi - 4*H), base + dt.timedelta(minutes=midi + 4*H)
if __name__ == '__main__':
    import sys
    lat, lon = 50.3832, 5.6143   # Point 0 de la Rando VTT, Ferrières
    for s in ['2026-11-11', '2026-11-28', '2026-06-21', '2026-12-21', '2026-03-29', '2026-10-25']:
        d = dt.date.fromisoformat(s)
        lv, co = evenement(d, lat, lon, 90.833); _, civ = evenement(d, lat, lon, 96); _, nau = evenement(d, lat, lon, 102)
        f = lambda x: x.astimezone(TZ).strftime('%H:%M')
        print(s, 'lever', f(lv), 'coucher', f(co), 'fin civil', f(civ), 'fin nautique', f(nau))
