#target photoshop

var BLUR_RADIUS = 11;
var CANVAS_PADDING = BLUR_RADIUS * 2;

var scriptFile = new File($.fileName);
var inputFolder = scriptFile.parent;

var outputFolder = new Folder(inputFolder.fsName + "/Glow");

if (!outputFolder.exists) {
    outputFolder.create();
}

var files = inputFolder.getFiles("*.png");

for (var i = 0; i < files.length; i++) {

    var doc = open(files[i]);

    var origWidth = doc.width.as("px");
    var origHeight = doc.height.as("px");

    var layer = doc.layers[0];
    doc.activeLayer = layer;

    var color = new SolidColor();
    color.rgb.hexValue = "FFE288";

    layer.transparentPixelsLocked = true;
    doc.selection.selectAll();
    doc.selection.fill(color);
    doc.selection.deselect();
    layer.transparentPixelsLocked = false;

    doc.resizeCanvas(
        UnitValue(origWidth + CANVAS_PADDING * 2, "px"),
        UnitValue(origHeight + CANVAS_PADDING * 2, "px"),
        AnchorPosition.MIDDLECENTER
    );

    layer.applyGaussianBlur(BLUR_RADIUS);

    doc.resizeImage(
        UnitValue(origWidth, "px"),
        UnitValue(origHeight, "px"),
        doc.resolution,
        ResampleMethod.BICUBIC
    );

    var baseName = files[i].name.replace(/\.png$/i, "");
    var saveFile = new File(outputFolder.fsName + "/" + baseName + "_Glow.png");
    var pngOptions = new PNGSaveOptions();

    doc.saveAs(saveFile, pngOptions, true, Extension.LOWERCASE);
    doc.close(SaveOptions.DONOTSAVECHANGES);
}

alert("Готово!");
