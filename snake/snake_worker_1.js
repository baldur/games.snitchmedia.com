// Triggered by postMessage in the page
onmessage = function (evt) {
    if(evt.data[0] === 'check'){
        switch(evt.data[1]) {
        case "l":
          if(0 <= evt.data[3].left) {
              message = "ok";
          } else {
              message = "boom";
          }
          break;
        case "r":
          if(evt.data[2].width > evt.data[3].left) {
              message = "ok";
          } else {
              message = "boom";
          }
          break;
        case "u":
          if(0 <= evt.data[3].top) {
              message = "ok";
          } else {
              message = "boom";
          }
          break;
        case "d":
          if(evt.data[2].height > evt.data[3].top) {
              message = "ok";
          } else {
              message = "boom";
          }
          break;
        default:
          //code to be executed if n is different from case 1 and 2
        }
        postMessage(message);
    } else {
        postMessage('dont know how to process this');
    }
};
