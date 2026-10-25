ObjC.import('AVFoundation'); ObjC.import('AppKit'); ObjC.import('CoreMedia');
function run(argv){
 const asset=$.AVURLAsset.URLAssetWithURLOptions($.NSURL.fileURLWithPath(argv[0]),$());
 const dur=$.CMTimeGetSeconds(asset.duration);
 const gen=$.AVAssetImageGenerator.assetImageGeneratorWithAsset(asset);
 gen.appliesPreferredTrackTransform=true;
 gen.maximumSize={width:900,height:900};
 const n=18; let ok=0;
 for(let i=0;i<n;i++){
  const t=dur*i/n;
  const cg=gen.copyCGImageAtTimeActualTimeError($.CMTimeMakeWithSeconds(t,600),null,null);
  if(!cg) continue;
  const rep=$.NSBitmapImageRep.alloc.initWithCGImage(cg);
  const data=rep.representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG,$({}));
  data.writeToFileAtomically(argv[1]+'/f'+String(i).padStart(2,'0')+'_'+Math.round(t)+'s.jpg',true); ok++;
 }
 return 'duration '+dur+' frames '+ok;
}
