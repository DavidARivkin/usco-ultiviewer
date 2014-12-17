
Polymer('ulti-viewer', {
  /**
   * toggle to show grid or not
   * 
   * @attribute showGrid
   * @type boolean
  */
  showGrid: true,
  /**
   * toggle to show axes or not
   * 
   * @attribute showAxes
   * @type boolean
  */
  showAxes: true,
  /**
   * toggle to show camera controls or not
   * 
   * @attribute showControls
   * @type boolean
  */
  showControls: true,
  /**
   * toggle to show dimensions of selected object(s)
   * 
   * @attribute showDimensions
   * @type boolean
  */
  showDimensions: true,
  /**
   * toggle to show annotations of selected object(s)
   * 
   * @attribute showAnnotations
   * @type boolean
  */
  showAnnotations: true,
  /**
   * toggle for view auto rotation
   * 
   * @attribute autoRotate
   * @type boolean
  */
  autoRotate: false,
  /**
   * toggle to allow selection & autorotate: if false, selecting
   * object(s) stops the autorotation
   * 
   * @attribute selectRotate
   * @type boolean
  */
  selectRotate:true,
  
  /**
   * toggles zooming in on selected object
   * 
   * 
   * @attribute selectionZoom
   * @type boolean
  */
  selectionZoom:true,
  
  /**
   * orientation of the camera: top, left, right, bottom, diagonal
   * 
   * @attribute camOrientation
   * @type string
  */
  camOrientation:"diagonal",
  /**
   * how much time do we wait for before removing loading bar in case of an error
   * 
   * @attribute dismissalTimeOnError
   * @type integer
  */
  dismissalTimeOnError:3000, 
  /**
   * currently selected object (or first in list
   * of currently selected objects)
   * 
   * @attribute selectedObject
   * @type object
  */
  selectedObject : null,
  /**
   * list of all currently selected objects 
   * 
   * @attribute selectedObjects
   * @type list
  */
  selectedObjects:null,
  /**
   * list of all currently loaded resources
   * 
   * @attribute resources
   * @type list
  */
  resources : null, 
  
  //After this point, highly experimental attributes
  activeTool : null,
  toolCategory: null,
  
  annotations : [],
  activeAnnotation:null,
  hierarchy   : null,
  bom         : null,
  
  parts: {},
  partWaiters: {},
  //partId: 0, //FIXME: HACK , because we do not yet have "parts" with ids, when imporint meshes
  
  created: function()
  {
    this.resources = [];
    this.meshes    = [];
    this.minObjectSize = 20;//minimum size (in arbitrarty/opengl units) before requiring re-scaling (upwards)
    this.maxObjectSize = 200;//maximum size (in arbitrarty/opengl units) before requiring re-scaling (downwards)
    
    //note: annotation positions are relative to their parent
    this.annotations  = [];
    /*this.annotationsObserver = new ArrayObserver(this.annotations);
    
    this.annotationsObserver.open(function(splices) {
      console.log("gnaaa", splices);
      splices.forEach(function(splice) {
        console.log("index",splice.index); // index position that the change occurred.
        console.log("removed",splice.removed); // an array of values representing the sequence of elements which were removed
        console.log("added",splice.addedCount); // the number of elements which were inserted.
      });
      
    });*/
  },
  ready:function(){
    this.threeJs      = this.$.threeJs;
    this.assetManager = this.$.assetManager;
  },
  domReady:function()
  {
    //needed since we do not inherit from three-js but do composition
    if (this.requestFullscreen) document.addEventListener("fullscreenchange", this.onFullScreenChange.bind(this), false);
    if (this.mozRequestFullScreen) document.addEventListener("mozfullscreenchange", this.onFullScreenChange.bind(this), false);
    if (this.msRequestFullScreen) document.addEventListener("msfullscreenchange", this.onFullScreenChange.bind(this), false);
    if (this.webkitRequestFullScreen) document.addEventListener("webkitfullscreenchange", this.onFullScreenChange.bind(this), false);
    
     //add the selection helper
    //dimensions display helper
    this.objDimensionsHelper = new ObjectDimensionsHelper({textBgColor:"#ffd200"});
    this.addToScene( this.objDimensionsHelper, "helpers", {autoResize:false, autoCenter:false, persistent:true, select:false } );
    
    this.transformControls = new THREE.TransformControls(this.$.cam.object,this.$.perspectiveView);
    this.addToScene( this.transformControls, "helpers", {autoResize:false, autoCenter:false, persistent:true, select:false } );
    this.transformControls.enabled = false;
    
    this.camViewControls = new CamViewControls({size:9, cornerWidth:1.5,
      //planesColor:"#17a9f5",edgesColor:"#17a9f5",cornersColor:"#17a9f5",
      highlightColor:"#ffd200",
      opacity:0.95},
       [this.$.fooCam]);//[this.$.cam,
    this.camViewControls.init( this.$.fooCam.object, this.$.naviView );
    this.addToScene( this.camViewControls, "naviScene", {autoResize:false, autoCenter:false, persistent:true, select:false } );
    this.$.fooCtrl.init(this.$.fooCam.object, this.$.perspectiveView);
    
    this.threeJs.updatables.push( this.updateOverlays.bind(this) ); 
    
    this.async(function(){
      console.log("impl",this);
      this.$.perspectiveView.focus();
    },null,10);
    
    //fetch any parameters passed to viewer via url
    this.getUrlParams();
  },
  detached:function()
  {
    this.clearResources();
  },
  //internal api
  injectPlugin:function(pluginNode){
    //console.log("injecting plug in", pluginNode, pluginNode.methodsToInject);
    //inject plugin's methods
    for(var i=0;i<pluginNode.methodsToInject.length;i++)
    {
      var methodName    = pluginNode.methodsToInject[i];
      if(this[methodName]) throw new Error("Method '"+ methodName+"' already exists, cannot add it to "+this.localName);
      this[methodName]  = pluginNode[methodName];
    }
  },
  //public api
  loadMesh:function( uriOrData, options )
  {
    var options = options || {};
    var display = options.display === undefined ? true: options.display;
    var keepRawData = options.keepRawData === undefined ? true: options.keepRawData;
    
    if(!uriOrData){ console.warn("no uri or data to load"); return};
    var resourcePromise = this._loadResource( uriOrData );
    
    function loadFailed(res)
    {
      //TODO: do this cleanly via type checking or somethg
      var error = res.error;
      if( error.indexOf("No parser found") != -1)
      {
        error = "sorry, the "+resource.ext+" format is not supported";
      }
    }
    function onDisplayError(error){console.log("FAILED to display",error);};
    
    //FIXME: temporary hack for annotations etc
    var self = this;
    function afterAdded( mesh ){ 
      mesh.castShadow = true;
      //mesh.receiveShadow = true;
      var partId = mesh.userData.part.id;
      self.parts[ partId] = mesh ;
      if(self.partWaiters[ partId ])
      {
        console.log("resolving mesh for ", partId);
        self.partWaiters[ partId ].resolve( mesh );
      }
    }
    if( display ) return resourcePromise.then( this.addToScene.bind(this), onDisplayError ).then(afterAdded);
    
    return resourcePromise;
    //resourcePromise.then(resource.onLoaded.bind(resource), loadFailed, resource.onDownloadProgress.bind(resource) );
  },
  clearScene:function(sceneName){
    var sceneName = sceneName || "main";
    this.threeJs.clearScene(sceneName);
    
    this.selectedObjects = [];//TODO: move this to three-js element ?
    this.$.cam.resetView();
  },
  addToScene:function( object, sceneName, options )
  {
    var options = options || {};
    options.autoCenter = options.autoCenter === undefined ? true: options.autoCenter;
    options.autoResize = options.autoResize === undefined ? true: options.autoResize;
    options.minSize    = options.minSize === undefined ? this.minObjectSize: options.minSize; 
    options.maxSize    = options.maxSize === undefined ? this.maxObjectSize: options.maxSize; 
    options.persistent = options.persistent === undefined ? false: options.persistent; 
    options.select     = options.select === undefined ? true: options.select; 
    
    this.threeJs.addToScene( object, sceneName, options );
    //TODO: should we select the object we added by default ?
    //makes sense for single item viewer ...
    if(options.select) this.selectedObject = object;
    
    return object;
  },
  removeFromScene:function( object, sceneName )
  {
    var sceneName = sceneName || "main" ;
    this.threeJs.removeFromScene( object, sceneName );
  },
  _loadResource:function(uriOrData)
  {
    var self = this;
    var resource = this.assetManager.loadResource( uriOrData, {parsing:{useWorker:true,useBuffers:true} } );
    this.resources.push( resource );
    
    var resourceDeferred = resource.deferred;
    
    //TODO: UNIFY api for parsers, this is redundant
    function formatResource(resource)
    {
      //geometry
      var shape = resource.data;
      if( !(shape instanceof THREE.Object3D) )
      {
        //console.log("formating resource");
        //nice color: 0x00a9ff
        var material = new THREE.MeshPhongMaterial( { color: 0x17a9f5, specular: 0xffffff, shininess: 5, shading: THREE.FlatShading} );
        //new THREE.MeshLambertMaterial( {opacity:1,transparent:false,color: 0x0088ff} );
        shape = new THREE.Mesh(shape, material);
      }
      
      hashCode = function(s){
        return s.split("").reduce(function(a,b){a=((a<<5)-a)+b.charCodeAt(0);return a&a},0);              
      }

      shape.userData.part = {};
      shape.userData.part.name = resource.name;//"Part"+self.partId;
      shape.userData.part.id = hashCode(resource.uri)
      shape.userData.resource = resource;
      shape.name = resource.name;
      
      /*var geometry = shape.geometry;
      if(geometry)
      {
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometry.computeVertexNormals();//needed at least for .ply files
        geometry.computeFaceNormals();
      }*/
      return shape;
    }
    
    var self = this;
    return resourceDeferred.promise
      .then( formatResource)
      .fail( this.resourceLoadFailed.bind(this) );
  },
  resourceLoadFailed:function(resource)
  {
    console.log("failed to load resource", resource.error);
    //do not keep error message on screen for too long, remove it after a while
    this.async(function() {
      this.dismissResource(resource);
    }, null, this.dismissalTimeOnError);
  },
  clearResources:function()
  {
    this.assetManager.clearResources();
    this.resources = [];
  },
  //remove a resource
  dismissResource:function(resource){
    var index = this.resources.indexOf(resource);
    resource.deferred.reject("cancelling");
    this.assetManager.unloadResource( resource.uri );
    if (index > -1) this.resources.splice(index, 1);
  },
  //event handlers
  //prevents scrolling whole page if using scroll & mouse is within viewer
  onMouseWheel:function (event)
  {
    event.preventDefault();
    return false;
  },
  doubleTapHandler:function( event ){
    if(this.selectedObject){
      this.zoomInOnObject( this.selectedObject );
    }
  },
  handleDragOver:function(e) {
    if (e.preventDefault) {
      e.preventDefault();
    }
  },
  handleDrop:function(e)
  {
    if (e.preventDefault) {
      e.preventDefault(); // Necessary. Allows us to drop.
    }
    e.dataTransfer.dropEffect = 'copy'; 
    console.log("e",e,e.dataTransfer)
  
    var data = e.dataTransfer.getData("url");
    if( data!= "")
    {
      this.asyncFire('url-dropped', {data:data} );
      this.loadMesh( data );
      return;
    }
    
    var data=e.dataTransfer.getData("Text");
    if( data!= "" ){
        this.asyncFire('text-dropped', {data:data} );
        this.loadMesh( data );//e.detail.data
        return;
    }

    var files = e.dataTransfer.files;
    if(files)
    {
      this.asyncFire('files-dropped', {data:files});
      for (var i = 0, f; f = files[i]; i++) {
        this.loadMesh( f );
      }
      return;
    }
  },
  onReqDismissResource:function(event, detail, sender) {
    var resource = sender.templateInstance.model.resource;
    //console.log("resource",resource);
    this.dismissResource( resource );
  },
  onDownloadTap:function(event)
  {
     var link = document.createElement("a");
     //TODO: rethink this whole aspect: even when keeping the initial "raw" data
     //things are a bit convoluted : perhaps an intermediary step would be for the viewer
     //to be able to act as a "format converter": once we have working "writers/serialisers"
     //the initial data format would not matter and exporting data would be more clean
     var href = null;
     var download = null;
     
     //walk up the object tree
     function findSelectionsResource(object)
     {
        var currentObject = object;            
        while(currentObject)
        {
           if (!(!currentObject.meta))
           {
              return currentObject;
           }
           currentObject= object.parent;
        }
     }
     resourceRoot = findSelectionsResource(this.selectedObject);

     if( resourceRoot ) href = resourceRoot.meta.resource.uri;
     if( ! href) return;

		 link.href = href;
		 link.click();
     event.preventDefault();
     event.stopPropagation();
  },
  objectPicked:function(e){
    /*TODO: externalize all of this into custom elements for
      how to handle event binding ?
      perhaps better to use pub/sub ?
    */
    console.log("object picked", e);
    
    this.$.annotations.onPicked( e );
    var selection = this.$.annotations.getSelection();
    
    pickingDatas = e.detail.pickingInfos;
    if(pickingDatas.length == 0 || !this.selectedObject) return;
    
    var object= pickingDatas[0].object;//closest point
    
    //FIXME: hardCoded, do this better
    if(this.toolCategory === "annotations" && this.activeTool) return;
    //TODO: should be togglable behaviour
    if(this.selectionZoom) this.zoomInOnObject( object );
    //FIXME: weird issue with rescaled models and worldToLocal
  },
  //attribute change handlers
  onFullScreenChange:function()
  {
    console.log("fullscreenchanged");
    //workaround to reset this.fullScreen to correct value when pressing exit etc in full screen mode
    this.fullScreen = !(!document.fullscreenElement &&    // alternative standard method
    !document.mozFullScreenElement && !document.webkitFullscreenElement);
  },
  fullScreenChanged:function()
  {
    if(this.fullScreen)
    {
      if(this.requestFullScreen)this.requestFullScreen();
      if(this.webkitRequestFullScreen)this.webkitRequestFullScreen();
      if(this.mozRequestFullScreen)this.mozRequestFullScreen();
      if(this.msRequestFullscreen)this.msRequestFullscreen();
    }
    else
    {
      if(document.cancelFullScreen) document.cancelFullScreen();
      if(document.webkitCancelFullScreen) document.webkitCancelFullScreen();
      if(document.mozCancelFullScreen) document.mozCancelFullScreen();
      if(document.msCancelFullScreen) document.msCancelFullScreen();
    }
    
  },
  autoRotateChanged:function()
  {
    var controls = this.$.camCtrl;
    if(this.autoRotate == false ) return;
    
    var rotSpeed = {rotSpeed:0.0};
    var rotSpeedTarget = {rotSpeed:2.0}
    var tween = new TWEEN.Tween( rotSpeed )
    .to( rotSpeedTarget , 1000 )
    .easing( TWEEN.Easing.Linear.None )
    .onUpdate( function () {
      controls.autoRotateSpeed = rotSpeed.rotSpeed;
    } )
    .start();
  },
  highlightedObjectChanged:function(oldHovered,newHovered)
  {
    return;
    //console.log("highlightedObjectChanged",oldHovered,newHovered);
    this.selectionColor = 0xf7c634;//0xff5400;//0xfffccc;
	  this.outlineColor = 0xffc200;
    function validForOutline(selection)
    {
      return (!(selection.hoverOutline != null) && !(selection.outline != null) && !(selection.name === "hoverOutline") && !(selection.name === "boundingCage") && !(selection.name === "selectOutline"))
    }

    var curHovered = this.highlightedObject;

    if (curHovered != null )
    {
      var hoverEffect = new THREE.Object3D();
      var outline, outlineMaterial;
      curHovered.currentHoverHex = curHovered.material.color.getHex();
      curHovered.material.color.setHex(this.selectionColor);
      //curHovered.material.vertexColors = THREE.FaceColors;
      
      //curHovered.currentHoverHexSpec = curHovered.material.specular.getHex();
      //curHovered.material.specular.setHex(this.selectionColor);
      
      //curHovered.material.shininess=8; //.setHex(this.selectionColor);
      outlineMaterial = new THREE.MeshBasicMaterial({
          color: 0xffc200,
          side: THREE.BackSide
        });

      outlineMaterialTest = new THREE.LineBasicMaterial({
          color: 0xffc200,
          linewidth: 10
          //side: THREE.BackSide
        });
      outlineMaterialTest = new THREE.MeshBasicMaterial({ 
          color: 0xffc200,
          wireframe: true, wireframeLinewidth: 4 ,side: THREE.BackSide} );

      outline = new THREE.Object3D();//new THREE.Mesh(curHovered.geometry, outlineMaterial);
      outline.scale.multiplyScalar(1.03);
      outline.name = "hoverOutline";
      curHovered.hoverOutline = outline;
      curHovered.add(outline);
    }
    if(oldHovered != null)
    {
      if (oldHovered.hoverOutline != null)
      {
        oldHovered.material.color.setHex(oldHovered.currentHoverHex);
        //oldHovered.material.specular.setHex(oldHovered.currentHoverHexSpec);
        //oldHovered.material.shininess = 10;

        oldHovered.remove(oldHovered.hoverOutline);
        oldHovered.hoverOutline = null;
      }
    }
  },
  selectedObjectsChanged:function()
  {
    //f96a5e
    //console.log("selectedObjectsChanged", this.selectedObjects);
    if(this.selectedObjects)
    {
      if(this.selectedObjects.length>0)
      {
        this.selectedObject = this.selectedObjects[0];
      }
      else{
        this.selectedObject = null;
      }
    }
  },
  selectedObjectChanged:function(oldSelection)
  {
    //console.log("selectedObjectChanged", this.selectedObject);
    var newSelection = this.selectedObject;
    
    //this.clearVisualFocusOnSelection();
    if( oldSelection && oldSelection.helpers )
    {
      this.objDimensionsHelper.detach( oldSelection );
      this.transformControls.detach( oldSelection );
    }
    
    //FIXME: do this differently ?
    if(this.toolCategory === "annotations" &&  this.activeTool) return;
    
    //FIXME: keep the red outline ?
    //this.outlineObject( newSelection, oldSelection );
    if(this.selectionZoom) this.zoomInOnObject( newSelection );
    if(newSelection)
    {
      if(this.transformControls.enabled)  this.transformControls.attach( newSelection );
      if(this.showDimensions)
      {
        this.objDimensionsHelper.attach( newSelection );
        if(!(newSelection.helpers)) newSelection.helpers = {}
      }
      //this.visualFocusOnSelection(newSelection);
    }
    
  },
  //important data structure change watchers, not sure this should be here either
  annotationsChanged:function(oldAnnotations, newAnnotations, foo){
    if(oldAnnotations){
      if(oldAnnotations.length == 1)
      {
        if("removed" in oldAnnotations[0]){
          //console.log("array observer");
          newAnnotations = [ this.annotations[oldAnnotations[0].index ] ];
        }
      }
    }
    console.log("annotationschanged", oldAnnotations, newAnnotations, this.annotations);
    //console.log("parts", this.parts);
    var self = this;
    var Q = require("q");
    
    for(var i=0;i<newAnnotations.length;i++)
    {
      addAnnotation( newAnnotations[i] );
    }
    
    function addAnnotation( annotationData ){
      var annotationHelper = null;
      
      var annotation = {};
      for (var key in annotationData)
      {
        if(["position","normal","orientation","center","start","mid","end"].indexOf( key ) > -1 )
        {
          annotation[key] = new THREE.Vector3().fromArray( annotationData[key] );
        }
        else if(["object","startObject","midObject","endObject"].indexOf( key ) > -1 ){
          if(!annotation._instances) annotation._instances = {};
          annotation._instances[key] = annotationData[key];//push( annotationData[key] );
        }
        else{
          annotation[key] = annotationData[key];
        }
      }
      //console.log("annotation",annotation);
      
      var partsToWaitFor = [];
      var argNames = [];
      for( var key in annotation._instances  )//var i=0;i<annotation._instances.length;i++)
      {
        var partId = annotation._instances[key];
        
        if(!self.partWaiters[ partId ] )
        {
          //console.log(" no waiters for", partId);
          self.partWaiters[ partId ] = Q.defer();
        }
        partsToWaitFor.push( self.partWaiters[ partId ].promise );
        argNames.push( key );
        
        //var partIndex = self.parts.indexOf( partId );
        //resolve all waiters where 
        if( partId in self.parts)
        {
          self.partWaiters[ partId ].resolve( self.parts[ partId ] );
        }
        
      }
      //only add annotation once ALL its dependency parts have been loaded
      Q.all( partsToWaitFor).then(function(res)
      {
        //console.log("all meshes/parts loaded, yeah !", res);
        for(var i=0;i<argNames.length;i++)
        {
          var key = argNames[i];
          annotation[key] = res[i];
        }
        finalizeAnnotation();
      });
      
      
      function finalizeAnnotation(){
        
        switch(annotation.type)
        {
          case "distance":
            var annotationHelper = new DistanceHelper({arrowColor:0x000000,
              textBgColor:"#ffd200",
              start:annotation.start, end:annotation.end,
              startObject:annotation.startObject,
              endObject:annotation.endObject
              });
              
            //annotationHelper.position.sub( annotation.startObject.position );
            //annotation.startObject.add( annotationHelper );
            
            //TODO: uughh do not like this
            //this.threeJs.updatables.push( annotationHelper ); 
            //annotationHelper.set( {start:annotationHelper.start, end:annotationHelper.end} );
            annotationHelper.updatable = true;
            self.addToScene( annotationHelper, "helpers", {autoResize:false, autoCenter:false, persistent:false, select:false } );
            
          break;
          case "thickness":
            var annotationHelper = new ThicknessHelper({arrowColor:0x000000,
              textBgColor:"#ffd200",
              thickness:annotation.value, point:annotation.position,
              normal: annotation.normal});
              
            annotationHelper.position.sub( annotation.object.position );
            annotation.object.add( annotationHelper );
          break;
          
          case "diameter":
            var annotationHelper = new DiameterHelper({arrowColor:0x000000,
              textBgColor:"#ffd200",
              diameter:annotation.value, orientation:annotation.orientation,
              center:annotation.center});
              
            annotationHelper.position.sub( annotation.object.position );
            annotation.object.add( annotationHelper );
          break;
          case "angle":
            var annotationHelper = new AngularDimHelper({arrowColor:0x000000,
              textBgColor:"#ffd200",
              start:annotation.start, mid: annotation.mid, end:annotation.end,
              startObject:annotation.startObject,
              midObject:annotation.midObject,
              endObject:annotation.endObject});
              
            annotationHelper.position.sub( annotation.startObject.position );
            annotation.startObject.add( annotationHelper );
          break;
          case "note":
            var annotationHelper = new NoteHelper({arrowColor:0x000000,
              textBgColor:"#ffd200",
              point:annotation.position, object:annotation.object})
              
            annotationHelper.position.sub( annotation.object.position );
            annotation.object.add( annotationHelper );
        }
      }
    }
  },
  activeToolChanged:function(oldTool,newTool){
    console.log("activeToolChanged",oldTool,newTool, this.activeTool);
  },
  toolCategoryChanged:function(oldCateg,newCateg){
    console.log("toolCategoryChanged",oldCateg,newCateg, this.toolCategory);
  },
  
  
  //helpers
  //FIXME: this is a "helper"/transform/whatever 
  //just like centering , resizing etc... food for thought/
  //refactoring
  //TODO: move these somewhere else, preferably a helper
  focusOnObject  :function(newSelection, oldSelection)
  {
    //visual helper: make objects other than main selection slightly transparent
    if( newSelection ) {
      for(var i = 0; i < this.rootAssembly.children.length;i++)
      {
        var child = this.rootAssembly.children[i];
        if(selection == child)
        {
          child.material.opacity = child.material._oldOpacity;
          child.material.transparent = child.material._oldTransparent;
          continue;
        }
        child.material._oldOpacity = child.material.opacity;
        child.material._oldTransparent = child.material.transparent;
        child.oldRenderDepth = child.renderDepth;
    
        //child.renderDepth = 0;
        //child.material.renderDepth = 0;
        child.material.opacity = 0.3;
        child.material.transparent = true;
      }
    }
    
    if(!newSelection && !oldSelection)
    {
      for(var i = 0; i < this.rootAssembly.children.length;i++)
      {
        var child = this.rootAssembly.children[i];
        child.material.opacity = child.material._oldOpacity;
        child.material.transparent = child.material._oldTransparent;
        //child.renderDepth = child.material._oldRenderDepth;
      }
    }
  },
  zoomInOnObject:function( object , options){
    var scope = this;//TODO: this is temporary, until this "effect" is an object
   //possible alternative to resizing : zooming in on objects
    if(!object) return;
    
    var options = options || {};
    
    var orientation = options.orientation === undefined ? null: options.orientation;//to force a given "look at " vector
    var distance = options.distance === undefined ? 3: options.distance;
    var zoomTime = options.zoomTime === undefined ? 400: options.zoomTime;
    
    var camera = this.$.cam.object;
    var camPos = camera.position.clone();
    var camTgt = camera.target.clone();
    var camTgtTarget =object.position.clone();
    
    var camPosTarget = camera.position.clone().sub( object.position ) ;
    
    //camera.target.copy( object.position );
    var camLookatVector = new THREE.Vector3( 0, 0, 1 );
    camLookatVector.applyQuaternion( camera.quaternion );
    camLookatVector.normalize();
    camLookatVector.multiplyScalar( object.boundingSphere.radius*distance );
    camLookatVector = object.position.clone().add( camLookatVector );
    
    camPosTarget = camLookatVector;
    
    var precision = 0.001;
    
    //console.log(camPosTarget, camPos);
    //Simple using vector.equals( otherVector) is not good enough 
    if(Math.abs(camPos.x - camPosTarget.x)<= precision &&
     (Math.abs(camPos.y - camPosTarget.y)<= precision) &&
     (Math.abs(camPos.z - camPosTarget.z)<= precision) )
    {
      //already at target, do nothing
      return;
    }   
    var tween = new TWEEN.Tween( camPos )
      .to( camPosTarget , zoomTime )
      .easing( TWEEN.Easing.Quadratic.In )
      .onUpdate( function () {
        camera.position.copy(camPos);   
      } )
      .start();
      var tween2 = new TWEEN.Tween( camTgt )
      .to( camTgtTarget , zoomTime )
      .easing( TWEEN.Easing.Quadratic.In )
      .onUpdate( function () {
        camera.target.copy(camTgt);   
      } )
      .start();
      //tween2.chain( tween );
      //tween2.start();
   },
   outlineObject:function(newSelection, oldSelection)
  {
    this.selectionColor = 0xfffccc;
    //remove from old selection
    if(oldSelection != null)
    {
      oldSelection.remove(oldSelection.outline);
      oldSelection.cage = null;
      oldSelection.outline = null;
      //oldSelection.material.color.setHex( oldSelection.currentSelectHex );
    }
    //add to new selection
    if(newSelection != null)
    {
        var outlineMaterial = new THREE.MeshBasicMaterial({
          color: 0xff0000,//0xffc200,
          side: THREE.BackSide
        });
        outline = new THREE.Mesh(newSelection.geometry, outlineMaterial);
        outline.name = "selectOutline";
        outline.scale.multiplyScalar(1.02);
        newSelection.outline = outline;
        newSelection.add(outline);
    }
  },
  //various
  updateOverlays: function(){
    var p, v, percX, percY, left, top;
    var camera = this.$.cam.object;
    var target = this.selectedObject;
    var projector = new THREE.Projector();

    var overlays = this.shadowRoot.querySelectorAll("overlay-note");
    
    for(var i=0;i<overlays.length;i++)
    {
      var overlay = overlays[i];
      var annotation = this.annotations[i];
      
      if( target.userData.part.id !== annotation.partId ) continue;
      
      var overlayEl = overlay;
      var offset = new THREE.Vector3().fromArray( annotation.position );
      
      if(!annotation.poi){

        var poi = new THREE.Object3D();
        poi.boundingSphere = new THREE.Sphere(offset.clone(), 15);
        
        //for debugging only
        var foo = new THREE.Mesh( new THREE.BoxGeometry(10,10,10), new THREE.MeshBasicMaterial({color:0xFF0000,wireframe:true}) );
        var foo = new THREE.Mesh( new THREE.SphereGeometry(10,32,32), new THREE.MeshBasicMaterial({color:0xFF0000,wireframe:true}) );
        var bla = offset.clone();
        bla = target.localToWorld( bla );
        foo.position.copy( bla );
        //this.addToScene(foo, "main", {autoCenter:false,autoResize:false,select:false} );
        
        target.add(poi);
        poi.position.copy( bla );
        annotation.poi = poi;
      }
      
      if(!overlay.poi)
      {
        overlay.poi = annotation.poi;
        overlay.zoomInOnObject = this.zoomInOnObject.bind(this)
      }
      
      var self = this;
      drawOverlay( overlayEl, offset);
    }
    
    
    function drawOverlay( overlay , offset)
    {
      p = new THREE.Vector3().setFromMatrixPosition( target.matrixWorld );// target.matrixWorld.getPosition().clone();
      p.x += offset.x; 
      p.y += offset.y;
      p.z += offset.z;
      v = p.clone().project(camera);
      percX = (v.x + 1) / 2;
      percY = (-v.y + 1) / 2;
      
      // scale these values to our viewport size
      left = percX * self.clientWidth;
      top = percY * self.clientHeight;
      
      width = overlay.clientWidth;
      height = overlay.clientHeight;
      width = 30;
      height = 30;
      
      // position the overlay so that it's center is on top of
      // the sphere we're tracking
      overlay.style.left = (left - width / 2) + 'px'
      overlay.style.top = (top - height / 2) + 'px'
      //console.log("gna",overlay, left, top);
    }
    if(this.leaderLineTest) this.leaderLineTest.update();
  },
  
  //interactions
  annotationDone:function(e,detail,sender){
    var annotation = detail;
    console.log("annotation raw", annotation);
    //add annotationData to storage
    //FIXME , do this better
    for(key in annotation)
    {
      if(annotation[key] instanceof THREE.Vector3)
      {
        annotation[key] = annotation[key].toArray();
      }
      
      if(annotation[key] instanceof THREE.Object3D)
      {
        annotation.partId = annotation[key].userData.part.id;
        annotation[key] = annotation[key].userData.part.id;
        //delete annotation[key];
      }
      
      if(key === "point")
      {
        annotation["position"] = annotation[key];
        delete annotation[key];
      }
    }
    console.log("annotation done", annotation);
    this.annotations.push( annotation );
  },
  duplicateObject:function(){
    console.log("duplicating")
    if(!this.selectedObject) return;
    
    var cloned = this.selectedObject.clone();
    cloned.material = this.selectedObject.material.clone();
    
    this.addToScene( cloned, "main",{autoResize:false, autoCenter:false } );
  },
  
  deleteObject:function(){
    console.log("deleting")
    if(!this.selectedObject) return;
    this.removeFromScene( this.selectedObject, "main" );
    this.selectedObject = null;
  },
  
  toRotateMode:function(){
    this.transformControls.setMode("rotate");
  }, 
  toTranslateMode:function(){
    this.transformControls.setMode("translate");
  }, 
  
  //helpers
  getUrlParams:function( ){
    /*var url = window.location.href;
    var urlElems = url.split("?")
    var name = urlElems.shift().split("/").pop();
    var queryParams = urlElems.pop().split("&");
    
    console.log("URL", url, urlElems, name, queryParams);*/
    
    //see http://stackoverflow.com/questions/1034621/get-current-url-in-web-browser
    var match,
        pl     = /\+/g,  // Regex for replacing addition symbol with a space
        search = /([^&=]+)=?([^&]*)/g,
        decode = function (s) { return decodeURIComponent(s.replace(pl, " ")); },
        query  = window.location.search.substring(1);

    urlParams = {};
    while (match = search.exec(query))
    {
       var key = decode(match[1]);
       var value = decode(match[2]);
       if( key in urlParams){
        urlParams[key] = [urlParams[key]].concat([value]);
       }else
       {
        urlParams[key] = value
       }
    }
    //console.log("URL", urlParams);
    if("modelUrl" in urlParams)
    {
      if( Object.prototype.toString.call( urlParams["modelUrl"] ) === '[object Array]' )
      {
        for( var i=0;i<urlParams["modelUrl"].length;i++)
        {
          this.loadMesh(urlParams["modelUrl"][i],{display:true});
        }
      }
      else
      {
        this.loadMesh(urlParams["modelUrl"],{display:true});
      }
    }
  },
  //filters
  toFixed:function(o, precision){
    if(!o) return "";
    return o.toFixed(precision);
  },
  handleFullScreen:function(e){
    this.fullScreen = true;
    return true
  }
  
});
