"""Reproducible KRSL10 pilot on public hand coordinates. No ASL relabelling.

python -m pip install numpy scikit-learn onnx onnxruntime
python tools/train_krsl.py --data /path/to/krsl-recogniton/sign-prediction/V2-videos-5signers-isolated-signs-out/Absolute
Upstream acquisition: git clone --depth 1 https://github.com/kurshakuz/krsl-recogniton
Participant split is fixed before training: P1/P2/P3 train, P4 validation, P5 test.
Question/statement variants are merged into ten lexical signs (no facial grammar).
"""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score,confusion_matrix
import onnx
from onnx import helper as H,numpy_helper as N,TensorProto as T
import onnxruntime as ort

ROOT=Path(__file__).resolve().parents[1]
LABELS=[('gde','Где (место)','Қай жерде'),('kak','Как','Қалай'),('kakoi','Какой','Қандай'),('kogda','Когда','Қашан'),('kotoriy','Который','Қайсы'),('kto','Кто','Кім'),('kuda','Куда (направление)','Қайда (бағыт)'),('skolko','Сколько','Қанша'),('what','Что','Не'),('zachem','Зачем','Не үшін')]

def features(tokens):
    out=[]
    for hand in tokens:
        if not np.isfinite(hand).all() or np.max(np.abs(hand))<1e-6:continue
        scale=np.linalg.norm(hand[9]-hand[0])
        if scale<0.005:continue
        p=(hand-hand[0])/scale
        if p[5,0]>p[17,0]:p[:,0]*=-1
        out.append(np.clip(p,-5,5).reshape(-1))
    if len(out)<3:return None
    a=np.array(out,dtype=np.float32)
    return np.concatenate([a.mean(0),a.std(0),a.min(0),a.max(0)]).astype(np.float32)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,required=True);args=ap.parse_args()
    xs=[];ys=[];people=[];manifest=[];skipped=0
    for path in sorted(args.data.glob('*/*.txt')):
        word=path.parent.name.removesuffix('q')
        if word not in [r[0] for r in LABELS]:continue
        values=np.fromstring(path.read_text(),sep=' ',dtype=np.float32)
        values=values[:len(values)//42*42]
        f=features(values.reshape(-1,21,2))
        if f is None:skipped+=1;continue
        person=path.stem.split('-')[0]
        if person not in ['P1','P2','P3','P4','P5']:continue
        xs.append(f);ys.append([r[0] for r in LABELS].index(word));people.append(person)
        manifest.append({'file':str(path.relative_to(args.data)),'person':person,'label':word,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    x=np.array(xs);y=np.array(ys);people=np.array(people)
    train=np.isin(people,['P1','P2','P3']);val=people=='P4';test=people=='P5'
    scaler=StandardScaler().fit(x[train]);z=scaler.transform(x)
    # One fixed model: no selection on test participants and no random clip split.
    clf=MLPClassifier(hidden_layer_sizes=(96,),alpha=0.01,batch_size=128,max_iter=160,random_state=42,early_stopping=False)
    clf.fit(z[train],y[train])
    pv=clf.predict_proba(z[val]);pt=clf.predict_proba(z[test])
    threshold=0.8  # operational rejection threshold, NOT an open-set accuracy guarantee
    pred=pt.argmax(1);accepted=pt.max(1)>=threshold
    def result(mask):
        probs=clf.predict_proba(z[mask]);return {'clips':int(mask.sum()),'top1':float(accuracy_score(y[mask],probs.argmax(1)))}
    report={'task':'10 isolated KRSL lexical signs; question/statement variants merged','source':'https://github.com/kurshakuz/krsl-recogniton','source_commit':__import__('subprocess').check_output(['git','-C',str(args.data.parents[1]),'rev-parse','HEAD'],text=True).strip(),
      'dataset':'KRSL20 upstream Absolute hand-coordinate files','train':result(train),'validation':result(val),'test':result(test),'split':{'train':['P1','P2','P3'],'validation':['P4'],'test':['P5']},
      'threshold':threshold,'test_coverage':float(accepted.mean()),'test_accepted_accuracy':float((pred[accepted]==y[test][accepted]).mean()) if accepted.any() else None,
      'confusion_matrix':confusion_matrix(y[test],pred,labels=np.arange(10)).tolist(),'skipped_clips':skipped,'camera_accuracy_evaluated':False,
      'limitations':['Only one held-out test signer.','Modern Holistic tracker differs from the legacy hand detector; camera domain shift is unmeasured.','No facial grammar, no sentences.','Threshold is not calibrated on unknown signs.','Dataset recordings may contain multiple takes of the same sign.']}
    dest=ROOT/'web/public/models/krsl';dest.mkdir(parents=True,exist_ok=True)
    weights=[N.from_array(scaler.mean_.astype(np.float32),'mean'),N.from_array(scaler.scale_.astype(np.float32),'scale')]
    nodes=[H.make_node('Sub',['features','mean'],['centered']),H.make_node('Div',['centered','scale'],['standardized'])]
    prev='standardized'
    for i,(w,b) in enumerate(zip(clf.coefs_,clf.intercepts_)):
        weights.extend([N.from_array(w.astype(np.float32),f'w{i}'),N.from_array(b.astype(np.float32),f'b{i}')])
        nodes.extend([H.make_node('MatMul',[prev,f'w{i}'],[f'mm{i}']),H.make_node('Add',[f'mm{i}',f'b{i}'],[f'linear{i}'])])
        if i<len(clf.coefs_)-1:nodes.append(H.make_node('Relu',[f'linear{i}'],[f'h{i}']));prev=f'h{i}'
        else:nodes.append(H.make_node('Identity',[f'linear{i}'],['logits']))
    graph=H.make_graph(nodes,'signtalk-krsl10-mlp',[H.make_tensor_value_info('features',T.FLOAT,[1,168])],[H.make_tensor_value_info('logits',T.FLOAT,[1,10])],weights)
    model=H.make_model(graph,opset_imports=[H.make_opsetid('',17)],ir_version=8);onnx.checker.check_model(model);onnx.save(model,dest/'model.onnx')
    sess=ort.InferenceSession(str(dest/'model.onnx'),providers=['CPUExecutionProvider'])
    errors=[]
    for index in np.flatnonzero(test)[:10]:
        logits=sess.run(None,{'features':x[index:index+1]})[0][0];p=np.exp(logits-logits.max());p/=p.sum();errors.append(float(np.abs(p-clf.predict_proba(z[index:index+1])[0]).max()))
    assert max(errors)<1e-4
    report['onnx_max_probability_error']=max(errors)
    labels=[{'id':key,'ru':ru,'kk':kk} for key,ru,kk in LABELS]
    (dest/'labels.json').write_text(json.dumps(labels,ensure_ascii=False,indent=2))
    (dest/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    examples=[]
    for label_index in range(10):
        ix=int(np.flatnonzero(test & (y==label_index))[0])
        examples.append({'label':LABELS[label_index][0],'ru':LABELS[label_index][1],'kk':LABELS[label_index][2],'features':x[ix].tolist(),'source':'Held-out participant P5; pre-recorded hand features, not a live camera'})
    (dest/'examples.json').write_text(json.dumps(examples,ensure_ascii=False))
    (dest/'meta.json').write_text(json.dumps({'id':'krsl10','classes':10,'input':'features','dim':168,'threshold':threshold,'experimental':True,'source':report['source']},indent=2))
    audit=ROOT/'docs/krsl';audit.mkdir(parents=True,exist_ok=True)
    (audit/'training-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False))
    # Feature parity fixture: raw hand points plus Python features, no video.
    fixture_path=args.data/manifest[0]['file'];values=np.fromstring(fixture_path.read_text(),sep=' ',dtype=np.float32)
    tokens=values[:len(values)//42*42].reshape(-1,21,2)
    (ROOT/'shared/fixtures/krsl-features.json').write_text(json.dumps({'tokens':tokens.tolist(),'features':features(tokens).tolist()}))
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
if __name__=='__main__':main()
