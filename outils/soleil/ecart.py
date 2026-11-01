import datetime as dt, json
from soleil import evenement, TZ
TABLE = {11:'17h10',12:'16h40',1:'17h00',2:'17h50',3:'18h40',10:'18h50',9:'19h50',4:'20h30',8:'20h50'}
lat, lon = 50.3832, 5.6143
d = dt.date(2026,1,1); rows=[]
while d.year == 2026:
    _, co = evenement(d, lat, lon, 90.833); _, civ = evenement(d, lat, lon, 96)
    co = co.astimezone(TZ); civ = civ.astimezone(TZ)
    t = TABLE.get(d.month, '21h40'); th, tm = map(int, t.split('h'))
    reel = co.hour*60 + co.minute + co.second/60
    rows.append((d, th*60+tm - reel, co.strftime('%H:%M'), civ.strftime('%H:%M')))
    d += dt.timedelta(days=1)
pire = max(rows, key=lambda r: abs(r[1]))
print('écart max', round(pire[1]), 'min le', pire[0], 'réel', pire[2])
for m in range(1,13):
    e=[r[1] for r in rows if r[0].month==m]
    print(m, 'de', round(min(e)), 'à', round(max(e)), 'min')
print('jours à plus de 30 min d erreur :', sum(abs(r[1])>30 for r in rows), '/ 365 ; plus de 15 min :', sum(abs(r[1])>15 for r in rows))
# série hebdo pour graphique
json.dump([(r[0].isoformat(), round(r[1])) for r in rows[::7]], open('serie.json','w'))
