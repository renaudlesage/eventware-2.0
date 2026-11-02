import csv, datetime as dt, statistics as st
def t(s): return dt.datetime.strptime('2026-'+s,'%Y-%m-%d %H:%M') if s else None
R=[]
for ref,p,c,a,d,r in csv.reader(open('log.csv'),delimiter=';'):
    R.append(dict(ref=ref,p=p,c=t(c),a=t(a),d=t(d),r=t(r)))
# prise en charge = première trace d'action : attribution, sinon démarrage
for x in R:
    pc=[v for v in (x['a'],x['d']) if v]; x['pc']=min(pc) if pc else None
    x['delai']=(x['pc']-x['c']).total_seconds()/60 if x['pc'] else None
# charge à la création : demandes ouvertes (créées, non résolues) — sans compter celle-ci
for x in R:
    x['ouvertes']=sum(1 for y in R if y is not x and y['c']<=x['c'] and y['r']>x['c'])
    x['en_attente']=sum(1 for y in R if y is not x and y['c']<=x['c'] and (y['pc'] or y['r'])>x['c'])
M=[x for x in R if x['delai'] is not None and x['delai']>=0]
print('demandes avec prise en charge horodatée', len(M), '/', len(R))
for k in range(0,12):
    g=[x['delai'] for x in M if x['ouvertes']==k]
    if g: print(f'ouvertes={k:2d} n={len(g):2d} médiane={st.median(g):5.1f} max={max(g):5.0f}')
print()
for lo,hi in [(0,3),(4,6),(7,20)]:
    g=[x['delai'] for x in M if lo<=x['ouvertes']<=hi]
    gp=[x['delai'] for x in M if lo<=x['ouvertes']<=hi and x['p']=='P1']
    print(f'{lo}-{hi} ouvertes: n={len(g)} médiane={st.median(g):.1f} moy={st.mean(g):.1f} >10min={sum(v>10 for v in g)}/{len(g)}  P1: n={len(gp)} méd={st.median(gp) if gp else 0:.1f} max={max(gp) if gp else 0:.0f}')
print()
for x in sorted(M,key=lambda x:-x['delai'])[:10]: print(x['ref'],x['p'],x['c'].strftime('%d %H:%M'),'délai',round(x['delai']),'ouvertes',x['ouvertes'],'en attente',x['en_attente'])
# ouvertes max dans le temps
pts=sorted(set([x['c'] for x in R]+[x['r'] for x in R]))
mx=max(pts,key=lambda T: sum(1 for y in R if y['c']<=T<y['r']))
print('pic', mx, sum(1 for y in R if y['c']<=mx<y['r']))
print('\n--- silence avant la demande (min depuis la précédente activité du QG : création, prise en charge ou résolution) ---')
ev=sorted([v for x in R for v in (x['c'],x['pc'],x['r']) if v])
for x in M:
    prev=[v for v in ev if v<x['c']]
    x['silence']=(x['c']-prev[-1]).total_seconds()/60 if prev and prev[-1].date()==x['c'].date() else None
S=[x for x in M if x['silence'] is not None]
for lo,hi in [(0,5),(6,15),(16,30),(31,999)]:
    g=[x['delai'] for x in S if lo<=x['silence']<=hi]
    if g: print(f'silence {lo}-{hi} min: n={len(g):2d} médiane délai={st.median(g):5.1f} moy={st.mean(g):5.1f} >10min={sum(v>10 for v in g)}/{len(g)}')
import math
def spearman(a,b):
    ra=[sorted(a).index(v) for v in a]; rb=[sorted(b).index(v) for v in b]
    n=len(a); ma=sum(ra)/n; mb=sum(rb)/n
    return sum((x-ma)*(y-mb) for x,y in zip(ra,rb))/math.sqrt(sum((x-ma)**2 for x in ra)*sum((y-mb)**2 for y in rb))
print('corrélation rang délai/ouvertes', round(spearman([x['delai'] for x in M],[x['ouvertes'] for x in M]),2))
print('corrélation rang délai/silence', round(spearman([x['delai'] for x in S],[x['silence'] for x in S]),2), 'n', len(S))
# par priorité
for p in ['P1','P2','P3']:
    g=[x['delai'] for x in M if x['p']==p]; print(p, len(g), 'médiane', st.median(g), 'p90', sorted(g)[int(0.9*len(g))-1] if len(g)>1 else g)
# P1 jamais pris en charge horodaté
print('sans prise en charge', [(x['ref'],x['p'],round((x['r']-x['c']).total_seconds()/60)) for x in R if x['pc'] is None])
# heure
for h0,h1 in [(9,12),(12,15),(15,18),(18,24)]:
    g=[x['delai'] for x in M if h0<=x['c'].hour<h1]; print(f'{h0}-{h1}h n={len(g)} méd={st.median(g)}')
