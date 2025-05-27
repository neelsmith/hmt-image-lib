// hmt-image-lib.js
(function (global) {
    'use strict';

    const IIIF_PROTOCOL = 'http';
    const IIIF_SERVER = 'www.homermultitext.org/iipsrv?IIIF=';
    const IIIF_BASE_PATH = '/project/homer/pyramidal/deepzoom';

    // --- Helper function to parse URN ---
    function parseURN(urnString) {
        if (!urnString || typeof urnString !== 'string') {
            console.error('Invalid URN string:', urnString);
            return null;
        }

        const parts = urnString.split(':');
        if (parts.length < 5) {
            console.error('URN string too short:', urnString);
            return null;
        }

        const baseUrnParts = parts.slice(0, 5);
        let roi = null;
        const objectIdFull = parts[4];
        let objectId = objectIdFull;

        if (objectIdFull.includes('@')) {
            const objectIdAndRoi = objectIdFull.split('@');
            objectId = objectIdAndRoi[0];
            baseUrnParts[4] = objectId; 

            if (objectIdAndRoi.length > 1 && objectIdAndRoi[1]) {
                const roiParts = objectIdAndRoi[1].split(',');
                if (roiParts.length === 4) {
                    roi = {
                        x: parseFloat(roiParts[0]),
                        y: parseFloat(roiParts[1]),
                        w: parseFloat(roiParts[2]),
                        h: parseFloat(roiParts[3]),
                    };
                } else {
                    console.warn('Invalid ROI format in URN:', urnString);
                }
            }
        }
        
        const namespace = parts[2];
        const collectionVersion = parts[3];
        const collectionParts = collectionVersion.split('.');
        
        if (collectionParts.length < 2) {
            console.error('Invalid collection component in URN:', urnString);
            return null;
        }

        return {
            baseUrn: baseUrnParts.join(':'),
            namespace: namespace,
            collectionPart1: collectionParts[0],
            collectionPart2: collectionParts[1],
            objectId: objectId,
            roi: roi
        };
    }

    // --- getIIIFImageUrl ---
    function getIIIFImageUrl(urnString, options = {}) {
        const parsedUrn = parseURN(urnString);
        if (!parsedUrn) return null;

        const { namespace, collectionPart1, collectionPart2, objectId, roi } = parsedUrn;

        const iiifPrefix = `${IIIF_BASE_PATH}/${namespace}/${collectionPart1}/${collectionPart2}`;
        const imageIdentifier = `${objectId}.tif`;

        let regionParam = 'full';
        if (roi) {
            regionParam = `pct:${roi.x * 100},${roi.y * 100},${roi.w * 100},${roi.h * 100}`;
        } else if (options.region) {
             regionParam = options.region;
        }

        let sizeParam = 'full';
        if (options.width && options.height) {
            if (options.width >= options.height) {
                sizeParam = `${Math.round(options.width)},`;
            } else {
                sizeParam = `,${Math.round(options.height)}`;
            }
        } else if (options.width) {
            sizeParam = `${Math.round(options.width)},`;
        } else if (options.height) {
            sizeParam = `,${Math.round(options.height)}`;
        } else if (options.size) {
            sizeParam = options.size;
        }

        const rotationParam = '0';
        const qualityParam = 'default';
        const formatParam = 'jpg';

        return `${IIIF_PROTOCOL}://${IIIF_SERVER}${iiifPrefix}/${imageIdentifier}/${regionParam}/${sizeParam}/${rotationParam}/${qualityParam}.${formatParam}`;
    }

    // --- HMTImageViewer Class ---
    class HMTImageViewer {
        constructor(elementId, urnString, viewerOptions = {}) {
            this.container = document.getElementById(elementId);
            if (!this.container) {
                throw new Error(`Element with ID '${elementId}' not found.`);
            }
            this.container.innerHTML = '';

            this.baseUrnParsed = parseURN(urnString);
            if (!this.baseUrnParsed) {
                throw new Error(`Invalid URN for viewer: ${urnString}`);
            }
            this.baseUrn = this.baseUrnParsed.baseUrn;

            this.rectangleSelectedListener = viewerOptions.rectangleSelectedListener || function() {};
            this.queryListener = viewerOptions.queryListener || function() {};

            this.canvas = document.createElement('canvas');
            this.ctx = this.canvas.getContext('2d');
            this.container.appendChild(this.canvas);
            this._updateCursor(); // Set initial cursor

            this.originalWidth = 0;
            this.originalHeight = 0;
            this.currentImage = new Image();
            this.currentImage.crossOrigin = "Anonymous";

            this.rectangles = []; 

            this.currentScale = 1.0;
            this.viewOriginX = 0;   
            this.viewOriginY = 0;   

            this.isPanning = false;
            this.isSelecting = false;
            this.lastMouseX = 0;
            this.lastMouseY = 0;
            this.selectionStartX = 0; 
            this.selectionStartY = 0; 
            this.currentSelectionRect = null;

            this._initEventListeners();
        }

        async init() {
            try {
                const infoUrl = `${IIIF_PROTOCOL}://${IIIF_SERVER}${IIIF_BASE_PATH}/${this.baseUrnParsed.namespace}/${this.baseUrnParsed.collectionPart1}/${this.baseUrnParsed.collectionPart2}/${this.baseUrnParsed.objectId}.tif/info.json`;
                const response = await fetch(infoUrl, { mode: 'cors' });
                if (!response.ok) throw new Error(`Failed to fetch image info: ${response.statusText}`);
                const infoData = await response.json();
                this.originalWidth = infoData.width;
                this.originalHeight = infoData.height;

                this.resizeCanvasToContainer();
                this.fitImageToCanvas(); 
                this.loadCurrentImage();
            } catch (error) {
                console.error("Error initializing viewer:", error);
                this.ctx.font = "16px Arial";
                this.ctx.fillStyle = "red";
                this.ctx.fillText(`Error: ${error.message}`, 10, 50);
            }
        }
        
        resizeCanvasToContainer() {
            this.canvas.width = this.container.clientWidth;
            this.canvas.height = this.container.clientHeight;
        }

        fitImageToCanvas(mode = 'width') {
            if (this.originalWidth === 0 || this.originalHeight === 0) return;
            const canvasAspect = this.canvas.width / this.canvas.height;
            const imageAspect = this.originalWidth / this.originalHeight;

            if (mode === 'contain') {
                if (imageAspect > canvasAspect) {
                    this.currentScale = this.canvas.width / this.originalWidth;
                } else {
                    this.currentScale = this.canvas.height / this.originalHeight;
                }
            } else if (mode === 'height') {
                 this.currentScale = this.canvas.height / this.originalHeight;
            } else {
                 this.currentScale = this.canvas.width / this.originalWidth;
            }
            
            const displayWidth = this.originalWidth * this.currentScale;
            const displayHeight = this.originalHeight * this.currentScale;
            this.viewOriginX = (this.canvas.width - displayWidth) / 2;
            this.viewOriginY = (this.canvas.height - displayHeight) / 2;
        }

        loadCurrentImage() {
            if (this.originalWidth === 0 || this.originalHeight === 0) return;
            
            let regionX = -this.viewOriginX / this.currentScale;
            let regionY = -this.viewOriginY / this.currentScale;
            let regionW = this.canvas.width / this.currentScale;
            let regionH = this.canvas.height / this.currentScale;
            
            regionX = Math.max(0, regionX);
            regionY = Math.max(0, regionY);
            regionW = Math.min(this.originalWidth - regionX, regionW);
            regionH = Math.min(this.originalHeight - regionY, regionH);
            
            if (regionW <=0 || regionH <= 0) {
                this.redraw(); 
                return;
            }
            
            const iiifRegionParam = `${Math.round(regionX)},${Math.round(regionY)},${Math.round(regionW)},${Math.round(regionH)}`;
            const iiifSizeParam = `!${this.canvas.width},${this.canvas.height}`; 

            const imageUrl = getIIIFImageUrl(this.baseUrn, {
                region: iiifRegionParam,
                size: iiifSizeParam
            });

            if (!imageUrl) {
                console.error("Could not generate image URL for viewer display.");
                return;
            }
            
            this.currentImage.onload = () => {
                this.redraw();
            };
            this.currentImage.onerror = (e) => {
                console.error("Error loading image:", imageUrl, e);
                this.ctx.font = "16px Arial";
                this.ctx.fillStyle = "red";
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillText(`Error loading image.`, 10, 50);
            };
            this.currentImage.src = imageUrl;
        }

        redraw() {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (this.currentImage.complete && this.currentImage.naturalWidth > 0) {
                 let drawW = this.currentImage.width;
                 let drawH = this.currentImage.height;
                 let drawX = (this.canvas.width - drawW) / 2;
                 let drawY = (this.canvas.height - drawH) / 2;
                 this.ctx.drawImage(this.currentImage, drawX, drawY, drawW, drawH);
            }

            this.rectangles.forEach(rect => {
                this.ctx.fillStyle = rect.color;
                const canvasRectX = this.viewOriginX + (rect.x * this.originalWidth * this.currentScale);
                const canvasRectY = this.viewOriginY + (rect.y * this.originalHeight * this.currentScale);
                const canvasRectW = rect.w * this.originalWidth * this.currentScale;
                const canvasRectH = rect.h * this.originalHeight * this.currentScale;
                this.ctx.fillRect(canvasRectX, canvasRectY, canvasRectW, canvasRectH);
            });

            if (this.isSelecting && this.currentSelectionRect) {
                this.ctx.fillStyle = 'rgba(0, 100, 255, 0.3)';
                this.ctx.strokeStyle = 'rgba(0, 100, 255, 0.7)';
                this.ctx.lineWidth = 1;
                const cs = this.currentSelectionRect;
                const canvasRectX = this.viewOriginX + (cs.x * this.originalWidth * this.currentScale);
                const canvasRectY = this.viewOriginY + (cs.y * this.originalHeight * this.currentScale);
                const canvasRectW = cs.w * this.originalWidth * this.currentScale;
                const canvasRectH = cs.h * this.originalHeight * this.currentScale;
                this.ctx.fillRect(canvasRectX, canvasRectY, canvasRectW, canvasRectH);
                this.ctx.strokeRect(canvasRectX, canvasRectY, canvasRectW, canvasRectH);
            }
        }

        _getMousePosOnCanvas(event) {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top
            };
        }

        _canvasToImagePercentCoords(canvasX, canvasY) {
            if (this.originalWidth === 0 || this.originalHeight === 0 || this.currentScale === 0) {
                return { x:0, y:0 };
            }
            const imagePxX = (canvasX - this.viewOriginX) / this.currentScale;
            const imagePxY = (canvasY - this.viewOriginY) / this.currentScale;
            return {
                x: imagePxX / this.originalWidth,
                y: imagePxY / this.originalHeight
            };
        }
        
        _updateCursor(event = null) {
            if (this.isPanning) {
                this.canvas.style.cursor = 'grabbing';
            } else if (this.isSelecting) {
                this.canvas.style.cursor = 'crosshair';
            } else if (event && event.altKey) { // Hovering with Alt
                this.canvas.style.cursor = 'crosshair';
            } else if (event && event.shiftKey) { // Hovering with Shift
                this.canvas.style.cursor = 'help';
            } else { // Default hover
                this.canvas.style.cursor = 'grab';
            }
        }

        _initEventListeners() {
            this.canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
            this.canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
            this.canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
            this.canvas.addEventListener('mouseleave', this._onMouseLeave.bind(this));
            this.canvas.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
            this.canvas.addEventListener('click', this._onClick.bind(this));

            // Listen to key events on window to update cursor if keys are pressed/released
            // without mouse movement over canvas, though mousemove is primary for hover.
            window.addEventListener('keydown', this._onGlobalKeyDown.bind(this));
            window.addEventListener('keyup', this._onGlobalKeyUp.bind(this));
        }
        
        _onGlobalKeyDown(event) {
            // If mouse is over canvas, update cursor
            if (this.canvas.matches(':hover')) {
                 this._updateCursor(event);
            }
        }
        _onGlobalKeyUp(event) {
             if (this.canvas.matches(':hover')) {
                 this._updateCursor(event);
            }
        }


        _onMouseDown(event) {
            const pos = this._getMousePosOnCanvas(event);
            this.lastMouseX = pos.x;
            this.lastMouseY = pos.y;

            if (event.altKey) { 
                this.isSelecting = true;
                this.isPanning = false;
                const startPercentCoords = this._canvasToImagePercentCoords(pos.x, pos.y);
                this.selectionStartX = startPercentCoords.x;
                this.selectionStartY = startPercentCoords.y;
                this.currentSelectionRect = {
                    x: this.selectionStartX,
                    y: this.selectionStartY,
                    w: 0,
                    h: 0
                };
            } else if (!event.shiftKey) { // Pan only if not shift (shift is for query on click)
                this.isPanning = true;
                this.isSelecting = false;
            }
            this._updateCursor(event); // Update cursor based on action/keys
        }

        _onMouseMove(event) {
            const pos = this._getMousePosOnCanvas(event);
            if (this.isPanning) {
                const dx = pos.x - this.lastMouseX;
                const dy = pos.y - this.lastMouseY;
                this.viewOriginX += dx;
                this.viewOriginY += dy;
                this.lastMouseX = pos.x;
                this.lastMouseY = pos.y;
                this.loadCurrentImage(); 
            } else if (this.isSelecting) {
                const currentPercentCoords = this._canvasToImagePercentCoords(pos.x, pos.y);
                const x1 = Math.min(this.selectionStartX, currentPercentCoords.x);
                const y1 = Math.min(this.selectionStartY, currentPercentCoords.y);
                const x2 = Math.max(this.selectionStartX, currentPercentCoords.x);
                const y2 = Math.max(this.selectionStartY, currentPercentCoords.y);
                this.currentSelectionRect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
                this.redraw();
            }
            this._updateCursor(event); // Update cursor on hover
        }

        _onMouseUp(event) {
            const wasPanning = this.isPanning;
            const wasSelecting = this.isSelecting;

            this.isPanning = false;
            this.isSelecting = false;

            if (wasSelecting) {
                if (this.currentSelectionRect && this.currentSelectionRect.w > 0.001 && this.currentSelectionRect.h > 0.001) {
                    let { x, y, w, h } = this.currentSelectionRect;
                    x = Math.max(0, Math.min(1 - w, x));
                    y = Math.max(0, Math.min(1 - h, y));
                    w = Math.max(0, Math.min(1 - x, w));
                    h = Math.max(0, Math.min(1 - y, h));
                    
                    if (w > 0 && h > 0) {
                        const newRect = {
                            x: x, y: y, w: w, h: h,
                            urnWithRoi: `${this.baseUrn}@${x.toFixed(4)},${y.toFixed(4)},${w.toFixed(4)},${h.toFixed(4)}`,
                            color: `rgba(${Math.floor(Math.random()*255)}, ${Math.floor(Math.random()*255)}, ${Math.floor(Math.random()*255)}, 0.5)`
                        };
                        this.rectangles.push(newRect);
                        const allRectUrns = this.rectangles.map(r => r.urnWithRoi).join('\n');
                        this.rectangleSelectedListener(allRectUrns, this.rectangles); // Pass full rect objects too
                    }
                }
                this.currentSelectionRect = null;
                this.redraw();
            }
            this._updateCursor(event); // Update cursor after action ends
        }
        
        _onMouseLeave(event) {
            this.isPanning = false; // Stop panning if mouse leaves
            if (this.isSelecting) { // If was selecting, cancel it
                 this.isSelecting = false;
                 this.currentSelectionRect = null;
                 this.redraw();
            }
            this.canvas.style.cursor = 'grab'; // Reset to default grab
        }

        _onWheel(event) {
            event.preventDefault();
            const pos = this._getMousePosOnCanvas(event);
            const zoomIntensity = 0.1;
            const delta = event.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;

            const imgPtX = (pos.x - this.viewOriginX) / this.currentScale;
            const imgPtY = (pos.y - this.viewOriginY) / this.currentScale;

            this.currentScale *= delta;
            this.currentScale = Math.max(0.01, Math.min(this.currentScale, 20)); 

            this.viewOriginX = pos.x - (imgPtX * this.currentScale);
            this.viewOriginY = pos.y - (imgPtY * this.currentScale);

            this.loadCurrentImage();
        }

        _onClick(event) {
            // Click is primarily for query mode
            if (event.shiftKey) {
                const pos = this._getMousePosOnCanvas(event);
                const clickPercentCoords = this._canvasToImagePercentCoords(pos.x, pos.y);
                
                const clickedRects = this.rectangles.filter(rect => {
                    return clickPercentCoords.x >= rect.x &&
                           clickPercentCoords.x <= rect.x + rect.w &&
                           clickPercentCoords.y >= rect.y &&
                           clickPercentCoords.y <= rect.y + rect.h;
                });
                this.queryListener(clickedRects.map(r => r.urnWithRoi));
            }
            // Standard click (without shift or alt) doesn't do anything else here.
            // Pan is mousedown-drag-mouseup. Selection is alt-mousedown-drag-mouseup.
        }
        
        async setUrn(newUrnString) {
            this.baseUrnParsed = parseURN(newUrnString);
            if (!this.baseUrnParsed) {
                console.error(`Invalid URN for viewer: ${newUrnString}`);
                this.ctx.font = "16px Arial";
                this.ctx.fillStyle = "red";
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.fillText(`Error: Invalid URN.`, 10, 50);
                return;
            }
            this.baseUrn = this.baseUrnParsed.baseUrn;
            this.rectangles = []; 
            this.rectangleSelectedListener("", []); 
            this.queryListener([]); 
            await this.init();
        }

        removeRectangle(urnWithRoiToRemove) {
            const initialLength = this.rectangles.length;
            this.rectangles = this.rectangles.filter(rect => rect.urnWithRoi !== urnWithRoiToRemove);
            if (this.rectangles.length < initialLength) {
                this.redraw();
                const allRectUrns = this.rectangles.map(r => r.urnWithRoi).join('\n');
                this.rectangleSelectedListener(allRectUrns, this.rectangles); // Pass full rect objects too
                return true;
            }
            return false;
        }
        
        destroy() {
            window.removeEventListener('keydown', this._onGlobalKeyDown);
            window.removeEventListener('keyup', this._onGlobalKeyUp);
            this.canvas.removeEventListener('mousedown', this._onMouseDown);
            this.canvas.removeEventListener('mousemove', this._onMouseMove);
            this.canvas.removeEventListener('mouseup', this._onMouseUp);
            this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
            this.canvas.removeEventListener('wheel', this._onWheel);
            this.canvas.removeEventListener('click', this._onClick);
            if (this.container && this.canvas.parentNode === this.container) {
                this.container.removeChild(this.canvas);
            }
            this.container.innerHTML = '';
        }
    }

    function createViewer(elementId, urnString, viewerOptions = {}) {
        try {
            const viewer = new HMTImageViewer(elementId, urnString, viewerOptions);
            viewer.init(); 
            return viewer;
        } catch (error) {
            console.error(`Failed to create viewer for ${elementId}:`, error);
            const container = document.getElementById(elementId);
            if (container) {
                container.innerHTML = `<p style="color:red;">Error creating viewer: ${error.message}</p>`;
            }
            return null;
        }
    }

    const HMTImageLib = {
        createViewer,
        getIIIFImageUrl,
        _parseURN: parseURN 
    };

    global.HMTImageLib = HMTImageLib;

}(typeof window !== 'undefined' ? window : this));